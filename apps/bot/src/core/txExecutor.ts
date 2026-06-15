/**
 * Transaction execution core (W-11).
 *
 * The ONLY sanctioned path from a quoted route to the chain:
 *
 *   idempotency check → simulate (fail-closed) → EIP-1559 fees from feeHistory
 *   → broadcast via the user's delegated Privy wallet (session signer) → receipt watch.
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
import { prisma, Prisma } from "@fxbot/db";
import type { PublicClient } from "viem";
import { simulateRoute, type TradeTx } from "../fx/index.js";
import { incr } from "./metrics.js";
import { sendWalletTransaction } from "./privy.js";
import { getEip1559Fees, type Eip1559Fees } from "./fees.js";
import type { PendingTx } from "./txReplace.js";
import { assertTransition, isTxState, type TxState } from "./txState.js";
import { assertRouteAllowed, resolvePolicyMode, SignerPolicyError } from "./signerPolicy.js";
import { logger } from "../middleware/logger.js";

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
  /**
   * Optional server-derived EIP-1559 fees (e.g. a chosen Slow/Market/Fast
   * tier). Must be computed server-side — never accept client fee numbers.
   * When omitted, fees are read fresh from feeHistory (the Market tier).
   */
  fees?: Eip1559Fees;
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

  // ── Signer policy: only verified f(x) targets may ever be broadcast. ────
  // Runs before simulation so a disallowed route is rejected without spending
  // an RPC call. Fail-closed in "enforce" mode; "observe" logs and proceeds.
  try {
    const violations = assertRouteAllowed(txs, { walletAddress });
    if (violations.length > 0) {
      logger.warn(
        { recordId: record.id, type, violations },
        "signer policy observed disallowed tx(s) but mode=observe — broadcasting anyway"
      );
    }
  } catch (err) {
    if (err instanceof SignerPolicyError) {
      logger.error(
        { recordId: record.id, type, mode: resolvePolicyMode(), violations: err.violations },
        "signer policy refused route — not broadcasting"
      );
      return fail(`blocked by signer policy: ${err.message}`);
    }
    throw err;
  }

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

  // ── Fees: use the server-derived tier if supplied, else read feeHistory. ─
  let fees;
  try {
    fees = params.fees ?? (await getEip1559Fees(client));
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
    // Pin the nonce up front so a stuck tx can later be sped up / cancelled by
    // rebroadcasting at the SAME nonce (W-11 follow-on). Sequential txs are
    // awaited to a receipt before the next, so the pending count is correct.
    // Best-effort: a nonce-lookup blip must never abort a trade — we fall back
    // to Privy's auto-nonce and simply don't offer speed-up/cancel for that tx.
    let nonce: number | undefined;
    try {
      nonce = Number(await client.getTransactionCount({ address: walletAddress, blockTag: "pending" }));
    } catch (err) {
      logger.warn(
        { recordId: record.id, err: err instanceof Error ? err.message : String(err) },
        "nonce lookup failed — broadcasting with auto-nonce; speed-up/cancel unavailable for this tx"
      );
      nonce = undefined;
    }
    const gasLimit = (sim.gasUsed[i] * 120n) / 100n; // 20% headroom; refunded if unused.
    let hash: `0x${string}`;
    try {
      const sent = await sendWalletTransaction(walletId, {
        to: tx.to,
        data: tx.data,
        value: tx.value > 0n ? toHex(tx.value) : undefined,
        nonce: nonce !== undefined ? toHex(BigInt(nonce)) : undefined,
        chainId: 1,
        type: 2,
        gasLimit: toHex(gasLimit),
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
    // Persist the full replaceable pending tx so /speedup and /cancel can
    // rebroadcast it at the same nonce later. Cleared once confirmed/reverted.
    // Only when the nonce was captured — otherwise the tx isn't replaceable.
    const nextData: Record<string, unknown> = { ...(record.data as object), hashes };
    if (nonce !== undefined) {
      const pending: PendingTx = {
        hash,
        nonce,
        to: tx.to,
        data: tx.data,
        value: tx.value.toString(),
        gasLimit: gasLimit.toString(),
        maxFeePerGas: fees.maxFeePerGas.toString(),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
      };
      nextData.pending = pending;
    }
    await prisma.txRecord.update({
      where: { id: record.id },
      data: { hash, data: nextData as unknown as Prisma.InputJsonValue },
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

  // All txs landed — clear the replaceable pending tx (nothing to speed up).
  const fresh = await prisma.txRecord.findUnique({ where: { id: record.id } });
  const cleared = { ...((fresh?.data as object) ?? {}) } as Record<string, unknown>;
  delete cleared.pending;
  await prisma.txRecord.update({ where: { id: record.id }, data: { data: cleared as Prisma.InputJsonValue } });
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
