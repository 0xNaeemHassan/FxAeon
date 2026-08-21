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
import { prisma, Prisma } from "@fxaeon/db";
import type { PublicClient } from "viem";
import { simulateRoute, type TradeTx } from "../fx/index.js";
import { incr } from "./metrics.js";
import { broadcastTransaction, type MevMode } from "./broadcast.js";
import {
  getEip1559Fees,
  getEip1559FeeTiers,
  selectFeeTier,
  type FeeTierKey,
} from "./fees.js";
import type { PendingTx } from "./txReplace.js";
import { assertTransition, isTxState, type TxState } from "./txState.js";
import { assertRouteAllowed, resolvePolicyMode, SignerPolicyError } from "./signerPolicy.js";
import { logger } from "../middleware/logger.js";
import { checkTxCap } from "../middleware/rate-limiter.js";
import type { SupportedWalletChainId } from "./privy.js";
import { routeGasLimitWithHeadroom } from "./actionPresentation.js";

export const MAX_INITIAL_MAX_FEE_PER_GAS_WEI = 1_000n * 1_000_000_000n;
export const MAX_INITIAL_TOTAL_FEE_WEI = 500_000_000_000_000_000n; // 0.5 ETH

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
  /** Source chain for simulation, signer policy and broadcast. Defaults to Ethereum. */
  chainId?: SupportedWalletChainId;
  client: PublicClient;
  /**
   * MEV-protection mode for the BROADCAST (not reads). "flashbots" signs via
   * Privy and submits the raw tx privately to Flashbots Protect; "off" (the
   * default) broadcasts via Privy's public RPC. Pass the user's setting.
   */
  mev?: MevMode;
  /** Optional named tier. The executor resolves it from fresh feeHistory; raw
   * fee numbers are intentionally not accepted at this signing boundary. */
  feeTier?: FeeTierKey;
  /** Worst-case route fee displayed and accepted by the user at review. */
  maxTotalFeeWei?: bigint;
  /** Exact server-validated transfer for a user_withdraw intent only. */
  intentScopedWithdrawal?: {
    recipient: `0x${string}`;
    tokenAddress: `0x${string}` | null;
    amount: bigint;
  };
  /** Exact token/adapter/amount scope for a bridge intent. */
  intentScopedBridge?: {
    sourceChainId: SupportedWalletChainId;
    tokenAddress: `0x${string}`;
    oftTarget: `0x${string}`;
    amount: bigint;
  };
  /** Optional status hook (W-12 wires Telegram notifications here). */
  onStatus?: (status: TxState, detail?: string) => void;
  /** Receipt polling overrides (tests). */
  watch?: { pollMs?: number; timeoutMs?: number };
}

export type ExecuteRouteResult =
  | { ok: true; deduped: boolean; recordId: string; status: TxState; hashes: `0x${string}`[] }
  | { ok: false; deduped: boolean; recordId: string; status: TxState; error: string };

function resultForExisting(existing: { id: string; status: string; data: unknown }): ExecuteRouteResult {
  const status = isTxState(existing.status) ? existing.status : "failed";
  const hashes = ((existing.data as { hashes?: string[] })?.hashes ?? []) as `0x${string}`[];
  if (status === "failed" || status === "reverted" || status === "partial" || status === "cancelled") {
    return {
      ok: false,
      deduped: true,
      recordId: existing.id,
      status,
      error: status === "partial"
        ? "previous attempt completed only part of its transaction route — review Activity before retrying"
        : status === "cancelled"
          ? "previous transaction was cancelled"
          : `previous attempt ended in '${status}' — use a new idempotency key to retry`,
    };
  }
  if (status === "prepared" || status === "simulated" || status === "broadcasting") {
    // A process may have died between durable state transitions. Never call
    // an intent successful when no broadcast hash was persisted; and never
    // automatically reuse a key in `broadcasting`, where chain outcome is
    // uncertain. A live same-process duplicate waits on the in-flight promise
    // before it can reach this branch.
    return {
      ok: false,
      deduped: true,
      recordId: existing.id,
      status,
      error:
        status === "broadcasting"
          ? "a previous attempt may still be broadcasting; check Activity before retrying"
          : "a previous attempt was interrupted before broadcast; check Activity, then use a new idempotency key to retry",
    };
  }
  if (status === "broadcast") {
    // A persisted hash proves the transaction was submitted, not mined. Keep
    // duplicate callers on the same honest pending result instead of turning
    // a prior receipt timeout into a false "confirmed/opened" success.
    const hash = hashes.at(-1);
    return {
      ok: false,
      deduped: true,
      recordId: existing.id,
      status,
      error: `previous transaction is still pending${hash ? `: ${hash}` : "; check Activity before retrying"}`,
    };
  }
  return { ok: true, deduped: true, recordId: existing.id, status, hashes };
}

/**
 * In-process claim table for the single-service deployment. The database
 * unique key prevents duplicate records across instances, while this lock
 * prevents the same process from returning a misleading "prepared" success
 * to a concurrent duplicate before the winner has even simulated/broadcast.
 */
const inFlightByIdempotencyKey = new Map<string, Promise<ExecuteRouteResult>>();

/**
 * A delegated EOA has one nonce lane per chain. Two different intents for the
 * same wallet can otherwise both read the same pending nonce and one can
 * replace the other. Serialize the complete simulate/cap/broadcast sequence
 * for that lane in this single-service deployment. The database idempotency
 * key remains the cross-process duplicate authority.
 */
const walletExecutionTails = new Map<string, Promise<void>>();

async function withWalletExecutionLock<T>(
  params: Pick<ExecuteRouteParams, "walletId" | "chainId">,
  run: () => Promise<T>
): Promise<T> {
  const key = `${params.chainId ?? 1}:${params.walletId}`;
  const previous = walletExecutionTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  walletExecutionTails.set(key, tail);

  await previous.catch(() => undefined);
  try {
    return await run();
  } finally {
    release();
    if (walletExecutionTails.get(key) === tail) {
      walletExecutionTails.delete(key);
    }
  }
}

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

async function executeRouteClaimed(params: ExecuteRouteParams): Promise<ExecuteRouteResult> {
  const { userId, walletId, walletAddress, idempotencyKey, txs, type, client, onStatus } = params;
  const chainId: SupportedWalletChainId = params.chainId ?? 1;
  const mev: MevMode = params.mev ?? "off";
  if (txs.length === 0) {
    throw new Error("executeRoute: empty tx list");
  }
  if (params.intentScopedWithdrawal && type !== "withdraw") {
    throw new Error("executeRoute: intentScopedWithdrawal is only valid for withdrawals");
  }
  if (type === "withdraw" && !params.intentScopedWithdrawal) {
    throw new Error("executeRoute: withdrawals require an exact intent scope");
  }
  const isBridge = type.startsWith("bridge_");
  if (params.intentScopedBridge && !isBridge) {
    throw new Error("executeRoute: intentScopedBridge is only valid for bridge actions");
  }
  if (isBridge && !params.intentScopedBridge) {
    throw new Error("executeRoute: bridge actions require an exact intent scope");
  }
  if (params.intentScopedBridge?.sourceChainId !== undefined && params.intentScopedBridge.sourceChainId !== chainId) {
    throw new Error("executeRoute: bridge intent source chain does not match execution chain");
  }
  if (chainId === 8453 && mev === "flashbots") {
    throw new Error("executeRoute: Flashbots Protect is unavailable on Base; use mev='off'");
  }
  const clientChainId = client.chain?.id;
  if (clientChainId !== undefined && clientChainId !== chainId) {
    throw new Error(
      `executeRoute: client chainId ${clientChainId} does not match requested source chainId ${chainId}`
    );
  }

  // ── Idempotency: one key, one broadcast — ever. ─────────────────────────
  const existing = await prisma.txRecord.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
  });
  if (existing) {
    return resultForExisting(existing);
  }

  let record;
  try {
    record = await prisma.txRecord.create({
      data: {
        userId,
        idempotencyKey,
        status: "prepared" satisfies TxState,
        type,
        hash: null,
        data: {
          chainId,
          // Bind any later speed-up/cancel to the exact signing wallet used
          // for the original broadcast. A user's embedded wallet can rotate;
          // replaying old calldata from the new wallet is a new transaction.
          walletAddress: walletAddress.toLowerCase(),
          txs: txs.map((t) => ({ to: t.to, value: t.value.toString() })),
          steps: txs.map((t, index) => ({
            index,
            to: t.to,
            status: "prepared",
            hash: null,
          })),
          hashes: [],
        },
      },
    });
  } catch (err) {
    // Two concurrent requests may both pass findUnique. The database's unique
    // constraint is the final authority: the loser returns the winner's
    // record instead of surfacing P2002 or ever creating a second broadcast.
    if ((err as { code?: string })?.code !== "P2002") throw err;
    const raced = await prisma.txRecord.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
    if (!raced) throw err;
    return resultForExisting(raced);
  }
  let state: TxState = "prepared";

  const fail = async (error: string): Promise<ExecuteRouteResult> => {
    const latest = await prisma.txRecord.findUnique({ where: { id: record.id } });
    const failedData = { ...((latest?.data as object) ?? (record.data as object)), error };
    await prisma.txRecord.update({
      where: { id: record.id },
      data: { data: failedData as Prisma.InputJsonValue },
    });
    state = await setStatus(record.id, state, "failed", onStatus, error);
    return { ok: false, deduped: false, recordId: record.id, status: state, error };
  };

  // ── Signer policy: only verified f(x) targets may ever be broadcast. ────
  // Runs before simulation so a disallowed route is rejected without spending
  // an RPC call. Fail-closed in "enforce" mode; "observe" logs and proceeds.
  try {
    const violations = assertRouteAllowed(txs, {
      walletAddress,
      intentScopedWithdrawal: params.intentScopedWithdrawal,
      intentScopedBridge: params.intentScopedBridge,
      chainId,
    });
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

  // Cap logical actions immediately before any broadcast side effect. The
  // decision is persisted/atomic across the normal Redis-backed production
  // path and fails closed if its persisted check is unavailable.
  const txCap = await checkTxCap(userId);
  if (!txCap.allowed) {
    return fail(
      txCap.reason === "check_unavailable"
        ? "transaction safety limit is temporarily unavailable — try again later"
        : "daily transaction limit reached — try again after 00:00 UTC"
    );
  }

  // ── Fees: derive the selected named tier from fresh feeHistory here. ─────
  // Keeping raw fee numbers out of ExecuteRouteParams prevents a future or
  // compromised internal caller from converting user funds into miner tips.
  let fees;
  try {
    fees = params.feeTier
      ? selectFeeTier(await getEip1559FeeTiers(client), params.feeTier)
      : await getEip1559Fees(client);
  } catch (err) {
    return fail(`fee estimation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const routeGasLimit = routeGasLimitWithHeadroom(sim.gasUsed);
  const worstCaseNetworkFee = routeGasLimit * fees.maxFeePerGas;
  if (fees.maxFeePerGas > MAX_INITIAL_MAX_FEE_PER_GAS_WEI) {
    return fail("live max fee exceeds the 1000 gwei transaction safety cap");
  }
  if (worstCaseNetworkFee > MAX_INITIAL_TOTAL_FEE_WEI) {
    return fail("worst-case network fee exceeds the 0.5 ETH transaction safety cap");
  }
  if (
    params.maxTotalFeeWei !== undefined &&
    (params.maxTotalFeeWei <= 0n || worstCaseNetworkFee > params.maxTotalFeeWei)
  ) {
    return fail("live network fee exceeds the reviewed maximum — prepare a fresh quote");
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
      // MEV-protected sends require a nonce (we sign+broadcast ourselves). If
      // the best-effort nonce lookup above failed, don't silently downgrade a
      // user who asked for protection — surface it via the same error path.
      if (mev === "flashbots" && nonce === undefined) {
        throw new Error("could not determine nonce for MEV-protected (private) broadcast");
      }
      hash = await broadcastTransaction(
        walletId,
        {
          to: tx.to,
          data: tx.data,
          value: tx.value > 0n ? toHex(tx.value) : undefined,
          nonce: nonce !== undefined ? toHex(BigInt(nonce)) : undefined,
          gasLimit: toHex(gasLimit),
          maxFeePerGas: toHex(fees.maxFeePerGas),
          maxPriorityFeePerGas: toHex(fees.maxPriorityFeePerGas),
        },
        mev,
        { chainId }
      );
    } catch (err) {
      // Nothing left our hands for THIS tx (Privy errored before returning a
      // hash). Prior txs in the route may have landed — record keeps them.
      if (state === "broadcasting") {
        return fail(
          `broadcast of tx ${i + 1}/${txs.length} failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      // A previous route step is known mined, but this later step never left
      // our hands. Persist an explicit terminal partial outcome instead of
      // leaving Activity to imply that an old approval is still pending.
      const msg = `tx ${i + 1}/${txs.length} broadcast failed after earlier txs landed: ${err instanceof Error ? err.message : String(err)}`;
      const latest = await prisma.txRecord.findUnique({ where: { id: record.id } });
      const partialData = { ...((latest?.data as object) ?? (record.data as object)) } as Record<string, unknown>;
      const partialSteps = Array.isArray(partialData.steps)
        ? [...partialData.steps] as Array<Record<string, unknown>>
        : [];
      partialSteps[i] = { ...(partialSteps[i] ?? { index: i, to: tx.to }), status: "failed", error: msg };
      partialData.steps = partialSteps;
      partialData.error = msg;
      delete partialData.pending;
      await prisma.txRecord.update({
        where: { id: record.id },
        data: { data: partialData as Prisma.InputJsonValue },
      });
      state = await setStatus(record.id, state, "partial", onStatus, msg);
      return { ok: false, deduped: false, recordId: record.id, status: state, error: msg };
    }

    hashes.push(hash);
    // Persist the full replaceable pending tx so /speedup and /cancel can
    // rebroadcast it at the same nonce later. Cleared once confirmed/reverted.
    // Only when the nonce was captured — otherwise the tx isn't replaceable.
    const latestBeforePersist = await prisma.txRecord.findUnique({ where: { id: record.id } });
    const latestData = { ...((latestBeforePersist?.data as object) ?? (record.data as object)) } as Record<string, unknown>;
    const persistedHashes = Array.isArray(latestData.hashes)
      ? latestData.hashes.filter((item): item is `0x${string}` => typeof item === "string" && item.startsWith("0x"))
      : [];
    const nextData: Record<string, unknown> = {
      ...latestData,
      hashes: [...new Set([...persistedHashes, ...hashes])],
    };
    const steps = Array.isArray(nextData.steps)
      ? [...nextData.steps] as Array<Record<string, unknown>>
      : txs.map((item, stepIndex) => ({ index: stepIndex, to: item.to, status: "prepared", hash: null }));
    steps[i] = { ...steps[i], status: "broadcast", hash, nonce: nonce ?? null };
    nextData.steps = steps;
    // The replacement flow is currently Ethereum-only. Do not persist a Base
    // tx in the legacy pending shape or /speedup could replay it on mainnet.
    if (nonce !== undefined && chainId === 1) {
      const pending: PendingTx = {
        hash,
        nonce,
        to: tx.to,
        data: tx.data,
        value: tx.value.toString(),
        gasLimit: gasLimit.toString(),
        maxFeePerGas: fees.maxFeePerGas.toString(),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
        routeIndex: i,
        routeLength: txs.length,
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
    const receipt = await waitForReceipt(client, hash, {
      ...params.watch,
      recordId: record.id,
      routeIndex: i,
    });
    if (receipt === "cancelled") {
      return {
        ok: false,
        deduped: false,
        recordId: record.id,
        status: "cancelled",
        error: `tx ${i + 1}/${txs.length} was cancelled at nonce ${nonce ?? "unknown"}`,
      };
    }
    if (receipt === "reverted") {
      const latest = await prisma.txRecord.findUnique({ where: { id: record.id } });
      const revertedData = { ...((latest?.data as object) ?? nextData) } as Record<string, unknown>;
      const revertedSteps = Array.isArray(revertedData.steps)
        ? [...revertedData.steps] as Array<Record<string, unknown>>
        : steps;
      revertedSteps[i] = { ...revertedSteps[i], status: "reverted", hash };
      revertedData.steps = revertedSteps;
      revertedData.error = `tx ${i + 1}/${txs.length} reverted on-chain: ${hash}`;
      delete revertedData.pending;
      await prisma.txRecord.update({
        where: { id: record.id },
        data: { data: revertedData as Prisma.InputJsonValue },
      });
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
      const latest = await prisma.txRecord.findUnique({ where: { id: record.id } });
      const pendingData = { ...((latest?.data as object) ?? nextData), error: msg };
      await prisma.txRecord.update({
        where: { id: record.id },
        data: { data: pendingData as Prisma.InputJsonValue },
      });
      onStatus?.(state, msg);
      return { ok: false, deduped: false, recordId: record.id, status: state, error: msg };
    }

    // This step is known mined (possibly via a same-nonce speed-up). Clear the
    // replaceable entry immediately, before attempting any later route step.
    const afterReceipt = await prisma.txRecord.findUnique({ where: { id: record.id } });
    const confirmedData = { ...((afterReceipt?.data as object) ?? nextData) } as Record<string, unknown>;
    const confirmedSteps = Array.isArray(confirmedData.steps)
      ? [...confirmedData.steps] as Array<Record<string, unknown>>
      : steps;
    const knownHash = confirmedSteps[i]?.status === "confirmed" && typeof confirmedSteps[i]?.hash === "string"
      ? confirmedSteps[i].hash
      : hash;
    confirmedSteps[i] = { ...confirmedSteps[i], status: "confirmed", hash: knownHash };
    confirmedData.steps = confirmedSteps;
    delete confirmedData.pending;
    await prisma.txRecord.update({
      where: { id: record.id },
      data: { data: confirmedData as Prisma.InputJsonValue },
    });
  }

  // All txs landed — clear the replaceable pending tx (nothing to speed up).
  const fresh = await prisma.txRecord.findUnique({ where: { id: record.id } });
  const cleared = { ...((fresh?.data as object) ?? {}) } as Record<string, unknown>;
  delete cleared.pending;
  await prisma.txRecord.update({ where: { id: record.id }, data: { data: cleared as Prisma.InputJsonValue } });
  state = await setStatus(record.id, state, "confirmed", onStatus, hashes[hashes.length - 1]);
  return { ok: true, deduped: false, recordId: record.id, status: state, hashes };
}


export async function executeRoute(params: ExecuteRouteParams): Promise<ExecuteRouteResult> {
  const scopedKey = `${params.userId}\u0000${params.idempotencyKey}`;
  const existingFlight = inFlightByIdempotencyKey.get(scopedKey);
  if (existingFlight) {
    const result = await existingFlight;
    return { ...result, deduped: true };
  }

  const flight = withWalletExecutionLock(params, () => executeRouteClaimed(params));
  inFlightByIdempotencyKey.set(scopedKey, flight);
  try {
    return await flight;
  } finally {
    if (inFlightByIdempotencyKey.get(scopedKey) === flight) {
      inFlightByIdempotencyKey.delete(scopedKey);
    }
  }
}

/**
 * Poll for a receipt with jittered backoff. Returns 'timeout' rather than
 * throwing — callers decide what an unknown outcome means.
 */
export async function waitForReceipt(
  client: Pick<PublicClient, "getTransactionReceipt">,
  hash: `0x${string}`,
  opts: { pollMs?: number; timeoutMs?: number; recordId?: string; routeIndex?: number } = {}
): Promise<"confirmed" | "reverted" | "cancelled" | "timeout"> {
  const pollMs = opts.pollMs ?? 4_000;
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const receipt = await client.getTransactionReceipt({ hash });
      if (receipt) return receipt.status === "success" ? "confirmed" : "reverted";
    } catch {
      // Same-nonce replacements have a different hash. Their worker records
      // the route-step outcome so this original executor can continue after a
      // speed-up or stop immediately after a cancellation.
      if (opts.recordId && opts.routeIndex !== undefined) {
        try {
          const record = await prisma.txRecord.findUnique({ where: { id: opts.recordId } });
          const steps = (record?.data as { steps?: Array<{ status?: unknown }> } | null)?.steps;
          const replacementStatus = steps?.[opts.routeIndex]?.status;
          if (replacementStatus === "confirmed") return "confirmed";
          if (replacementStatus === "reverted") return "reverted";
          if (replacementStatus === "cancelled") return "cancelled";
        } catch {
          // DB observation is advisory; chain polling remains authoritative.
        }
      }
      // Not mined yet (viem throws TransactionReceiptNotFoundError) — keep polling.
    }
    const jitter = Math.floor(Math.random() * pollMs * 0.25);
    await new Promise((r) => setTimeout(r, pollMs + jitter));
  }
  return "timeout";
}
