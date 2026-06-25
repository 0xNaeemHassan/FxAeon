/**
 * Replace a stuck (pending) transaction — speed-up or cancel (W-11 follow-on).
 *
 * Ethereum has no "edit a pending tx" primitive. The only way to change a tx
 * that is already in the mempool is to broadcast a NEW tx with the SAME nonce
 * and a high enough fee that miners prefer it. Geth's replacement rule requires
 * each EIP-1559 fee field to rise by >= 10%; we bump by 12.5% (and re-floor to
 * fresh market fees if the base fee has since spiked) so the replacement is
 * reliably accepted.
 *
 *   speed-up : rebroadcast the *same* call (to/data/value) at the same nonce
 *              with bumped fees — the original action still happens, faster.
 *   cancel   : broadcast a 0-value self-send at the same nonce with bumped
 *              fees — it mines instead of the original, voiding it. A self-send
 *              is allowed by the signer policy (recipient == own wallet).
 *
 * Both replacements go back through `assertRouteAllowed` and the receipt
 * watcher, exactly like a first broadcast. Nothing here bypasses the policy.
 */
import type { PublicClient } from "viem";
import { prisma, Prisma } from "@fxaeon/db";
import { type Eip1559Fees, getEip1559Fees } from "./fees.js";
import type { TradeTx } from "../fx/index.js";
import { broadcastTransaction, type MevMode } from "./broadcast.js";
import { assertRouteAllowed, SignerPolicyError, resolvePolicyMode } from "./signerPolicy.js";
import { waitForReceipt } from "./txExecutor.js";
import { logger } from "../middleware/logger.js";

/** A persisted, replaceable pending transaction (stored on TxRecord.data.pending). */
export interface PendingTx {
  hash: `0x${string}`;
  nonce: number;
  to: `0x${string}`;
  data?: `0x${string}`;
  /** wei, decimal string (JSON-safe bigint). */
  value: string;
  /** gas limit, decimal string. */
  gasLimit: string;
  /** wei, decimal string. */
  maxFeePerGas: string;
  /** wei, decimal string. */
  maxPriorityFeePerGas: string;
}

const BUMP_NUM = 1125n; // +12.5%
const BUMP_DEN = 1000n;
const CANCEL_GAS_LIMIT = 21_000n;

/**
 * Bump a single fee field: ceil(prev * 1.125), never less than `floor`, and
 * always strictly greater than `prev` (a +0 bump is rejected by every node).
 */
export function bumpFee(prev: bigint, floor = 0n): bigint {
  if (prev < 0n) throw new Error("bumpFee: negative fee");
  const bumped = (prev * BUMP_NUM + BUMP_DEN - 1n) / BUMP_DEN; // ceil division
  const strictlyGreater = bumped > prev ? bumped : prev + 1n;
  return strictlyGreater > floor ? strictlyGreater : floor;
}

/**
 * Produce replacement fees from the previous fees, optionally re-floored to a
 * fresh market quote so a replacement issued during a base-fee spike still
 * outbids the current block. Guarantees maxFeePerGas >= maxPriorityFeePerGas
 * and a >= 12.5% rise on both fields vs `prev`.
 */
export function bumpFees(prev: Eip1559Fees, fresh?: Eip1559Fees): Eip1559Fees {
  const maxPriorityFeePerGas = bumpFee(prev.maxPriorityFeePerGas, fresh?.maxPriorityFeePerGas ?? 0n);
  let maxFeePerGas = bumpFee(prev.maxFeePerGas, fresh?.maxFeePerGas ?? 0n);
  if (maxFeePerGas < maxPriorityFeePerGas) maxFeePerGas = maxPriorityFeePerGas;
  return {
    maxFeePerGas,
    maxPriorityFeePerGas,
    nextBaseFee: fresh?.nextBaseFee ?? prev.nextBaseFee,
  };
}

/** Build the 0-value self-send used to cancel a pending tx at `nonce`. */
export function buildCancelTx(walletAddress: `0x${string}`): TradeTx {
  return { to: walletAddress, data: "0x", value: 0n };
}

/** Restore the EIP-1559 fees a pending tx was last broadcast with. */
export function feesFromPending(p: PendingTx): Eip1559Fees {
  return {
    maxFeePerGas: BigInt(p.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(p.maxPriorityFeePerGas),
    nextBaseFee: BigInt(p.maxFeePerGas) - BigInt(p.maxPriorityFeePerGas), // best-effort; only fee fields matter for a bump
  };
}

/** Reconstruct the original call of a pending tx (for speed-up). */
export function txFromPending(p: PendingTx): TradeTx {
  return { to: p.to, data: (p.data ?? "0x") as `0x${string}`, value: BigInt(p.value) };
}

export interface ReplacementPlan {
  kind: "speedup" | "cancel";
  tx: TradeTx;
  nonce: number;
  fees: Eip1559Fees;
  gasLimit: bigint;
}

/**
 * Pure planner: given a pending tx and the desired action, compute the exact
 * replacement (same nonce, bumped fees). The caller broadcasts it through the
 * normal policy-checked path. `walletAddress` is the user's own wallet (the
 * recipient of a cancel self-send). `fresh` is the current market fee (optional).
 */
export function planReplacement(
  pending: PendingTx,
  kind: "speedup" | "cancel",
  walletAddress: `0x${string}`,
  fresh?: Eip1559Fees
): ReplacementPlan {
  const fees = bumpFees(feesFromPending(pending), fresh);
  if (kind === "cancel") {
    return { kind, tx: buildCancelTx(walletAddress), nonce: pending.nonce, fees, gasLimit: CANCEL_GAS_LIMIT };
  }
  // speed-up keeps the original gas limit so the same call still fits.
  return { kind, tx: txFromPending(pending), nonce: pending.nonce, fees, gasLimit: BigInt(pending.gasLimit) };
}

/** Read a fresh market fee, swallowing RPC errors (replacement still works off the bump). */
export async function tryFreshFees(
  client: Pick<PublicClient, "getFeeHistory">
): Promise<Eip1559Fees | undefined> {
  try {
    return await getEip1559Fees(client);
  } catch {
    return undefined;
  }
}

// ── Side-effecting replacement (broadcasts through the same guarded path) ─────

const toHex = (v: bigint): `0x${string}` => `0x${v.toString(16)}`;

/** Pull the replaceable pending tx off a TxRecord's JSON data, if any. */
export function readPending(data: unknown): PendingTx | null {
  const p = (data as { pending?: PendingTx } | null)?.pending;
  return p && typeof p.nonce === "number" && typeof p.to === "string" ? p : null;
}

export type ReplaceResult =
  | { ok: true; kind: "speedup" | "cancel"; hash: `0x${string}`; status: "confirmed" }
  | { ok: false; reason: string };

/**
 * Speed up or cancel the pending tx recorded against `recordId`. Only a record
 * still in the `broadcast` state with a stored pending tx is replaceable. The
 * replacement is broadcast at the SAME nonce with bumped fees, re-checked
 * against the signer policy, and watched to a receipt — identical guarantees to
 * a first broadcast. Self-sends (cancel) are policy-allowed by construction.
 */
export async function executeReplacement(params: {
  recordId: string;
  walletId: string;
  walletAddress: `0x${string}`;
  client: PublicClient;
  kind: "speedup" | "cancel";
  /** MEV-protection mode for the replacement broadcast (default "off"). */
  mev?: MevMode;
  watch?: { pollMs?: number; timeoutMs?: number };
}): Promise<ReplaceResult> {
  const { recordId, walletId, walletAddress, client, kind } = params;
  const mev: MevMode = params.mev ?? "off";
  const record = await prisma.txRecord.findUnique({ where: { id: recordId } });
  if (!record) return { ok: false, reason: "no such tx record" };
  if (record.status !== "broadcast") {
    return { ok: false, reason: `tx is '${record.status}', not a pending broadcast — nothing to ${kind}` };
  }
  const pending = readPending(record.data);
  if (!pending) return { ok: false, reason: "no replaceable pending tx on record" };

  const plan = planReplacement(pending, kind, walletAddress, await tryFreshFees(client));

  // Re-assert the signer policy on the replacement (cancel = self-send → allowed).
  try {
    const violations = assertRouteAllowed([plan.tx], { walletAddress });
    if (violations.length > 0) {
      logger.warn({ recordId, kind, violations }, "policy observed replacement (mode=observe) — broadcasting anyway");
    }
  } catch (err) {
    if (err instanceof SignerPolicyError) {
      logger.error({ recordId, kind, mode: resolvePolicyMode(), violations: err.violations }, "signer policy refused replacement");
      return { ok: false, reason: `blocked by signer policy: ${err.message}` };
    }
    throw err;
  }

  let hash: `0x${string}`;
  try {
    // Same MEV-protection guarantees as a first broadcast: when the user opted
    // in, the replacement is signed and submitted privately to Flashbots too.
    hash = await broadcastTransaction(
      walletId,
      {
        to: plan.tx.to,
        data: plan.tx.data,
        value: plan.tx.value > 0n ? toHex(plan.tx.value) : undefined,
        nonce: toHex(BigInt(plan.nonce)),
        gasLimit: toHex(plan.gasLimit),
        maxFeePerGas: toHex(plan.fees.maxFeePerGas),
        maxPriorityFeePerGas: toHex(plan.fees.maxPriorityFeePerGas),
      },
      mev
    );
  } catch (err) {
    return { ok: false, reason: `replacement broadcast failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Track the replacement hash alongside the originals; refresh the pending fees.
  const prevHashes = ((record.data as { hashes?: string[] })?.hashes ?? []) as `0x${string}`[];
  const nextPending: PendingTx = {
    ...pending,
    hash,
    to: plan.tx.to,
    data: plan.tx.data,
    value: plan.tx.value.toString(),
    gasLimit: plan.gasLimit.toString(),
    maxFeePerGas: plan.fees.maxFeePerGas.toString(),
    maxPriorityFeePerGas: plan.fees.maxPriorityFeePerGas.toString(),
  };
  await prisma.txRecord.update({
    where: { id: recordId },
    data: { hash, data: { ...(record.data as object), hashes: [...prevHashes, hash], pending: nextPending } as unknown as Prisma.InputJsonValue },
  });

  const receipt = await waitForReceipt(client, hash, params.watch);
  if (receipt === "timeout") {
    return { ok: false, reason: `replacement broadcast (${hash}) not mined in the watch window — it may still land` };
  }
  // The replacement (or, in a race, the original) mined: this nonce is resolved.
  const after = await prisma.txRecord.findUnique({ where: { id: recordId } });
  const cleared = { ...((after?.data as object) ?? {}) } as Record<string, unknown>;
  delete cleared.pending;
  const finalStatus = receipt === "confirmed" ? "confirmed" : "reverted";
  await prisma.txRecord.update({ where: { id: recordId }, data: { status: finalStatus, data: cleared as Prisma.InputJsonValue } });
  if (receipt === "reverted") {
    return { ok: false, reason: `replacement ${hash} reverted on-chain` };
  }
  return { ok: true, kind, hash, status: "confirmed" };
}
