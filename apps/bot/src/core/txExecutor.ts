/**
 * Transaction execution core (W-11).
 *
 * The ONLY sanctioned path from a quoted route to the chain:
 *
 *   idempotency check → simulate (fail-closed) → EIP-1559 fees from feeHistory
 *   → broadcast via the policy-guarded Privy wallet → receipt watch.
 *
 * Guarantees:
 * - Idempotent: the same idempotencyKey never broadcasts twice. Double-taps,
 *   Telegram retries and worker restarts return the existing record instead.
 * - Simulate-before-broadcast: a failed or unavailable simulation aborts the
 *   trade. There is no "skip simulation" flag on purpose.
 * - Every status change goes through the txState state machine and is
 *   persisted before the next side effect, so a crash leaves an honest record.
 * - Receipt watching replaces the Privy transaction webhooks (enterprise-only):
 *   we broadcast every tx ourselves, so polling eth_getTransactionReceipt on
 *   our own RPC yields the same lifecycle with zero extra infra.
 */
import { prisma } from "@fxbot/db";
import type { PublicClient } from "viem";
import { simulateRoute, type TradeTx } from "../fx/index.js";
import { incr } from "./metrics.js";
import { sendWalletTransaction } from "./privy.js";
import { getEip1559Fees } from "./fees.js";
import { assertTransition, isTxState, type TxState } from "./txState.js";

const toHex = (v: bigint): `0x${string}` => `0x${v.toString(16)}`;

export interface ExecuteRouteParams {
  /** Internal DB user id (TxRecord.userId). */
  userId: string;
  /** Privy wallet id used to sign & broadcast. */
  walletId: string;
  /** The wallet's address — used as the simulation account. */
  walletAddress: `0x${string}`;
  /**
   * Caller-supplied idempotency key, e.g. `trade:<telegramId>:<callbackId>`.
   * MUST be unique per user intent — never derived from volatile data.
   */
  idempotencyKey: string;
  /** Ordered txs of one logical action (e.g. [approve, routerCall]). */
  txs: TradeTx[];
  /** TxRecord.type, e.g. 'open_long' | 'close' | 'fxsave_deposit'. */
  type: string;
  client: PublicClient;
  /** Optional status hook (W-12 wires Telegram notifications here). */
  onStatus?: (status: TxState, detail?: string) => void;
  /** Receipt polling overrides (tests). */
  watch?: { pollMs?: number; timeoutMs?: number };
}

export type ExecuteRouteResult =
  | { ok: true; deduped: boolean; recordId: string; status: TxState; hashes: `0x${string}`[] }
  | { ok: false; deduped: boolean; recordId: string; status: TxState; error: string };

async function setStatus(
  recordId: string,
  from: TxState,
  to: TxState,
  onStatus?: ExecuteRouteParams["onStatus"],
  detail?: string
): Promise<TxState> {
  assertTransition(from, to);
  await prisma.txRecord.update({ where: { id: recordId }, data: { status: to } });
  onStatus?.(to, detail);
  return to;
}

export async function executeRoute(params: ExecuteRouteParams): Promise<ExecuteRouteResult> {
  const { userId, walletId, walletAddress, idempotencyKey, txs, type, client, onStatus } = params;
  if (txs.length === 0) {
    throw new Error("executeRoute: empty tx list");
  }

  // ── Idempotency: one key, one broadcast — ever. ─────────────────────────
  const existing = await prisma.txRecord.findUnique({ where: { idempotencyKey } });
  if (existing) {
    const status = isTxState(existing.status) ? existing.status : "failed";
    const hashes = ((existing.data as { hashes?: string[] })?.hashes ?? []) as `0x${string}`[];
    if (status === "failed" || status === "reverted") {
      return {
        ok: false,
        deduped: true,
        recordId: existing.id,
        status,
        error: `previous attempt ended in '${status}' — use a new idempotency key to retry`,
      };
    }
    return { ok: true, deduped: true, recordId: existing.id, status, hashes };
  }

  const record = await prisma.txRecord.create({
    data: {
      userId,
      idempotencyKey,
      status: "prepared" satisfies TxState,
      type,
      hash: null,
      data: { txs: txs.map((t) => ({ to: t.to, value: t.value.toString() })), hashes: [] },
    },
  });
  let state: TxState = "prepared";

  const fail = async (error: string): Promise<ExecuteRouteResult> => {
    state = await setStatus(record.id, state, "failed", onStatus, error);
    return { ok: false, deduped: false, recordId: record.id, status: state, error };
  };

  // ── Simulate before broadcast (fail-closed, non-negotiable). ────────────
  const sim = await simulateRoute(client, walletAddress, txs);
  if (!sim.success) {
    incr("simulate.revert");
    return fail(
      `simulation failed${sim.failedTxIndex !== undefined ? ` at tx ${sim.failedTxIndex}` : ""}: ${sim.error}`
    );
  }
  incr("simulate.ok");
  state = await setStatus(record.id, state, "simulated", onStatus, `gas ${sim.totalGas}`);

  // ── Fees from feeHistory. ───────────────────────────────────────────────
  let fees;
  try {
    fees = await getEip1559Fees(client);
  } catch (err) {
    return fail(`fee estimation failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Broadcast sequentially; stop the line on the first problem. ─────────
  const hashes: `0x${string}`[] = [];
  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i];
    if (i === 0) {
      state = await setStatus(record.id, state, "broadcasting", onStatus, `tx ${i + 1}/${txs.length}`);
    }
    let hash: `0x${string}`;
    try {
      const sent = await sendWalletTransaction(walletId, {
        to: tx.to,
        data: tx.data,
        value: tx.value > 0n ? toHex(tx.value) : undefined,
        chainId: 1,
        type: 2,
        // 20% headroom over the simulated per-tx gas; refunded if unused.
        gasLimit: toHex((sim.gasUsed[i] * 120n) / 100n),
        maxFeePerGas: toHex(fees.maxFeePerGas),
        maxPriorityFeePerGas: toHex(fees.maxPriorityFeePerGas),
      });
      hash = sent.hash as `0x${string}`;
    } catch (err) {
      // Nothing left our hands for THIS tx (Privy errored before returning a
      // hash). Prior txs in the route may have landed — record keeps them.
      if (state === "broadcasting") {
        return fail(
          `broadcast of tx ${i + 1}/${txs.length} failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      // state === 'broadcast' (a previous tx already landed): record stays
      // 'broadcast' — the sweep worker / operator must reconcile manually.
      const msg = `tx ${i + 1}/${txs.length} broadcast failed after earlier txs landed: ${err instanceof Error ? err.message : String(err)}`;
      onStatus?.(state, msg);
      return { ok: false, deduped: false, recordId: record.id, status: state, error: msg };
    }

    hashes.push(hash);
    await prisma.txRecord.update({
      where: { id: record.id },
      data: { hash, data: { ...(record.data as object), hashes } },
    });
    if (state === "broadcasting") {
      state = await setStatus(record.id, state, "broadcast", onStatus, hash);
    }

    // Wait for THIS tx before sending the next (router call needs the approve).
    const receipt = await waitForReceipt(client, hash, params.watch);
    if (receipt === "reverted") {
      state = await setStatus(record.id, state, "reverted", onStatus, hash);
      return {
        ok: false,
        deduped: false,
        recordId: record.id,
        status: state,
        error: `tx ${i + 1}/${txs.length} reverted on-chain: ${hash}`,
      };
    }
    if (receipt === "timeout") {
      // Honest state: still 'broadcast'. Never guess a terminal state.
      const msg = `tx ${i + 1}/${txs.length} not mined within watch window: ${hash}`;
      onStatus?.(state, msg);
      return { ok: false, deduped: false, recordId: record.id, status: state, error: msg };
    }
  }

  state = await setStatus(record.id, state, "confirmed", onStatus, hashes[hashes.length - 1]);
  return { ok: true, deduped: false, recordId: record.id, status: state, hashes };
}

/**
 * Poll for a receipt with jittered backoff. Returns 'timeout' rather than
 * throwing — callers decide what an unknown outcome means.
 */
export async function waitForReceipt(
  client: Pick<PublicClient, "getTransactionReceipt">,
  hash: `0x${string}`,
  opts: { pollMs?: number; timeoutMs?: number } = {}
): Promise<"confirmed" | "reverted" | "timeout"> {
  const pollMs = opts.pollMs ?? 4_000;
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const receipt = await client.getTransactionReceipt({ hash });
      if (receipt) return receipt.status === "success" ? "confirmed" : "reverted";
    } catch {
      // Not mined yet (viem throws TransactionReceiptNotFoundError) — keep polling.
    }
    const jitter = Math.floor(Math.random() * pollMs * 0.25);
    await new Promise((r) => setTimeout(r, pollMs + jitter));
  }
  return "timeout";
}
