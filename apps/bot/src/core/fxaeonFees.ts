/**
 * FxAeon fee wrapper — Phase 3 (Masterplan).
 *
 * Every confirmed action triggers a fee transfer:
 * - Leverage actions (open/close/adjust): 0.05% (5 bps)
 * - Other actions (fxSAVE deposit, mint, redeem, etc.): 0.01% (1 bps)
 *
 * Fee modes (FXAEON_FEE_MODE env, hot-toggleable via /api/admin/fee-mode):
 * - "observe" — log fee to FeeLedger but skip the on-chain transfer
 *               (default for the first 72 hours after launch)
 * - "enforce" — log to FeeLedger AND execute the on-chain transfer
 * - "off"     — disabled entirely (no log, no transfer)
 *
 * On-chain fee flow:
 * 1. ERC-20 fee: transferFrom(user, FEE_COLLECTOR, feeAmount)
 * 2. ETH-native fee: value send to FEE_COLLECTOR
 * 3. Post-tx fee: after a close, compute fee on returned collateral
 *    and initiate a separate fee transfer
 *
 * Failures:
 * - If the fee transfer fails, the trade itself is NOT reverted
 * - The failed fee is recorded as a "feeOrphan" in FeeLedger
 * - The fee-reconciler-poller retries orphans every 60s (max 3 retries)
 */
import { prisma } from "@fxaeon/db";
import { ADDRESSES } from "@fxaeon/shared";
import { botLogger } from "../middleware/logger.js";
import { getBotState, setBotState, BS_FEE_MODE } from "./botState.js";

// ── Fee Constants ───────────────────────────────────────────────────────────

/** Fee in basis points for leverage actions (open/close/adjust) */
export const LEVERAGE_FEE_BPS = 5; // 0.05%

/** Fee in basis points for other actions (fxSAVE, mint, redeem, etc.) */
export const OTHER_FEE_BPS = 1; // 0.01%

export const FEE_COLLECTOR = ADDRESSES.FEE_COLLECTOR as `0x${string}`;

// ── Fee Mode ────────────────────────────────────────────────────────────────

export type FeeMode = "off" | "observe" | "enforce";

/** Get the current fee mode (BotState → env → default "observe"). */
export async function getFeeMode(): Promise<FeeMode> {
  // Hot-toggleable: BotState overrides env
  try {
    const stored = await getBotState(BS_FEE_MODE);
    if (stored && ["off", "observe", "enforce"].includes(stored)) {
      return stored as FeeMode;
    }
  } catch {
    // BotState table might not exist yet
  }
  const env = process.env.FXAEON_FEE_MODE;
  if (env && ["off", "observe", "enforce"].includes(env)) return env as FeeMode;
  return "observe"; // default for first 72 hours
}

/** Set fee mode (hot-toggleable via admin endpoint). */
export async function setFeeMode(mode: FeeMode): Promise<void> {
  await setBotState(BS_FEE_MODE, mode);
  botLogger.info({ mode }, "fxaeonFees: fee mode updated");
}

// ── Fee Calculation ─────────────────────────────────────────────────────────

export type IntentKind =
  | "open_long"
  | "open_short"
  | "close_long"
  | "close_short"
  | "adjust_leverage"
  | "increase_position"
  | "reduce_position"
  | "fxsave_deposit"
  | "fxsave_withdraw"
  | "mint"
  | "redeem"
  | "bridge"
  | "lock"
  | "vote"
  | "claim";

/** Whether the intent kind is a leverage action (higher fee tier). */
export function isLeverageAction(kind: IntentKind): boolean {
  const leverageKinds: IntentKind[] = [
    "open_long",
    "open_short",
    "close_long",
    "close_short",
    "adjust_leverage",
    "increase_position",
    "reduce_position",
  ];
  return leverageKinds.includes(kind);
}

/** Get fee basis points for the given intent kind. */
export function getFeeBps(kind: IntentKind): number {
  return isLeverageAction(kind) ? LEVERAGE_FEE_BPS : OTHER_FEE_BPS;
}

/** Calculate fee amount from notional value. */
export function calculateFeeAmount(notionalWei: bigint, feeBps: number): bigint {
  return (notionalWei * BigInt(feeBps)) / 10_000n;
}

/** Calculate fee in USD from notional USD. */
export function calculateFeeUsd(notionalUsd: number, feeBps: number): number {
  return (notionalUsd * feeBps) / 10_000;
}

// ── Fee Preview ─────────────────────────────────────────────────────────────

export interface FeePreview {
  /** f(x) protocol fee (approx) */
  fxProtocolFeePct: string;
  /** FxAeon fee */
  fxAeonFeePct: string;
  /** FxAeon fee in USD */
  fxAeonFeeUsd: number;
  /** Total estimated fee */
  totalFeePct: string;
  /** Formatted lines for trade preview */
  lines: string[];
}

/**
 * Generate fee preview lines for the trade confirmation screen.
 * Shows f(x) protocol fee and FxAeon fee separately.
 */
export function buildFeePreview(
  kind: IntentKind,
  notionalUsd: number,
  leverage?: number
): FeePreview {
  const bps = getFeeBps(kind);
  const fxAeonFeeUsd = calculateFeeUsd(notionalUsd, bps);
  const fxAeonFeePct = (bps / 100).toFixed(2);

  // f(x) protocol fee estimate (varies by market and leverage)
  let fxProtocolFeePct: string;
  if (isLeverageAction(kind)) {
    // Protocol fee scales with leverage: base + (leverage - 1) × step
    // For wstETH: 0.1% base + 0.3% step; For WBTC: 0.3% base + 0.3% step
    const base = 0.1; // Approximate average
    const step = 0.3;
    const lev = leverage ?? 3;
    const protocolFee = base + (lev - 1) * step;
    fxProtocolFeePct = protocolFee.toFixed(2);
  } else {
    fxProtocolFeePct = "0.10";
  }

  const totalPct = (parseFloat(fxProtocolFeePct) + parseFloat(fxAeonFeePct)).toFixed(2);

  const lines = [
    `f(x) protocol fee:   ~${fxProtocolFeePct}%`,
    `FxAeon fee:          ${fxAeonFeePct}% ($${fxAeonFeeUsd.toFixed(2)})`,
    `Total est. fees:     ~${totalPct}%`,
  ];

  return {
    fxProtocolFeePct,
    fxAeonFeePct,
    fxAeonFeeUsd,
    totalFeePct: totalPct,
    lines,
  };
}

// ── FeeLedger Recording ─────────────────────────────────────────────────────

export interface FeeLedgerEntry {
  userId: string;
  referrerCode?: string | null;
  txHash?: string | null;
  intentKind: IntentKind;
  tokenAddress: string;
  tokenAmountWei: string;
  usdAmount: number;
  notionalUsd: number;
  feeBps: number;
  feeOrphan: boolean;
}

/**
 * Compute the payout cycle label (e.g. "2026-07") from the current date.
 */
function currentPayoutCycle(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Record a fee in the FeeLedger.
 * In "observe" mode, records with feeOrphan=false and no txHash.
 * In "enforce" mode, records with feeOrphan=true if transfer failed.
 */
export async function recordFee(entry: FeeLedgerEntry): Promise<void> {
  try {
    await prisma.feeLedger.create({
      data: {
        userId: entry.userId,
        referrerCode: entry.referrerCode,
        txHash: entry.txHash,
        intentKind: entry.intentKind,
        tokenAddress: entry.tokenAddress.toLowerCase(),
        tokenAmountWei: entry.tokenAmountWei,
        usdAmount: entry.usdAmount,
        notionalUsd: entry.notionalUsd,
        feeBps: entry.feeBps,
        feeOrphan: entry.feeOrphan,
        payoutCycle: currentPayoutCycle(),
      },
    });
    botLogger.info(
      {
        userId: entry.userId,
        kind: entry.intentKind,
        usd: entry.usdAmount,
        status: entry.status,
      },
      "fxaeonFees: fee recorded"
    );
  } catch (error) {
    botLogger.error({ error: String(error) }, "fxaeonFees: failed to record fee");
  }
}

// ── Apply Fee (main entry point for txExecutor) ─────────────────────────────

export interface ApplyFeeResult {
  /** Whether the fee was applied (false = mode is "off" or fee is zero) */
  applied: boolean;
  /** Fee mode that was active */
  mode: FeeMode;
  /** Fee amount in USD */
  feeUsd: number;
  /** Fee amount in wei (token units) */
  feeWei: bigint;
  /** Whether the fee transfer is orphaned (failed/pending retry) */
  feeOrphan: boolean;
  /** Fee transfer tx hash (only in enforce mode with successful transfer) */
  feeTxHash?: string;
}

/**
 * Look up the referrer code for a user (Phase 5 referral attribution).
 * Returns the user's referredBy code, or undefined if none.
 */
export async function resolveReferrerCode(userId: string): Promise<string | undefined> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { referredBy: true },
    });
    return user?.referredBy ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Apply FxAeon fee for a confirmed action.
 *
 * Called by txExecutor after a successful trade execution.
 * In "enforce" mode, this builds and broadcasts a fee transfer tx.
 * In "observe" mode, it only records to FeeLedger.
 * In "off" mode, it does nothing.
 *
 * Phase 5: Automatically resolves referrerCode from user.referredBy
 * if not explicitly provided — every FeeLedger insert gets referral attribution.
 */
export async function applyFxAeonFee(params: {
  userId: string;
  intentKind: IntentKind;
  notionalUsd: number;
  notionalWei: bigint;
  tokenAddress: string;
  referrerCode?: string;
  /** Execute the fee transfer on-chain (provided by caller) */
  executeFeeTransfer?: (
    tokenAddress: `0x${string}`,
    amount: bigint
  ) => Promise<{ hash: string } | null>;
}): Promise<ApplyFeeResult> {
  const mode = await getFeeMode();

  if (mode === "off") {
    return { applied: false, mode, feeUsd: 0, feeWei: 0n, feeOrphan: false };
  }

  const bps = getFeeBps(params.intentKind);
  const feeWei = calculateFeeAmount(params.notionalWei, bps);
  const feeUsd = calculateFeeUsd(params.notionalUsd, bps);

  if (feeWei === 0n) {
    return { applied: false, mode, feeUsd: 0, feeWei: 0n, feeOrphan: false };
  }

  // Phase 5: auto-resolve referrer code if not provided
  const referrerCode = params.referrerCode ?? (await resolveReferrerCode(params.userId));

  if (mode === "observe") {
    // Record in FeeLedger but don't transfer on-chain
    await recordFee({
      userId: params.userId,
      referrerCode,
      intentKind: params.intentKind,
      tokenAddress: params.tokenAddress,
      tokenAmountWei: feeWei.toString(),
      usdAmount: feeUsd,
      notionalUsd: params.notionalUsd,
      feeBps: bps,
      feeOrphan: false,
    });
    return { applied: true, mode, feeUsd, feeWei, feeOrphan: false };
  }

  // Enforce mode: attempt on-chain transfer
  let feeTxHash: string | undefined;
  let feeOrphan = true; // assume orphan until transfer succeeds

  if (params.executeFeeTransfer) {
    try {
      const result = await params.executeFeeTransfer(
        params.tokenAddress as `0x${string}`,
        feeWei
      );
      if (result?.hash) {
        feeTxHash = result.hash;
        feeOrphan = false;
      }
    } catch (error) {
      botLogger.warn(
        { error: String(error), userId: params.userId },
        "fxaeonFees: fee transfer failed — recording as orphan"
      );
    }
  }

  await recordFee({
    userId: params.userId,
    referrerCode,
    txHash: feeTxHash,
    intentKind: params.intentKind,
    tokenAddress: params.tokenAddress,
    tokenAmountWei: feeWei.toString(),
    usdAmount: feeUsd,
    notionalUsd: params.notionalUsd,
    feeBps: bps,
    feeOrphan,
  });

  return { applied: true, mode, feeUsd, feeWei, feeOrphan, feeTxHash };
}

/**
 * Get orphaned fees that need retry.
 * Returns FeeLedger rows where feeOrphan=true and no txHash yet.
 */
export async function getOrphanedFees(limit = 10): Promise<any[]> {
  try {
    return await prisma.feeLedger.findMany({
      where: {
        feeOrphan: true,
        txHash: null,
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  } catch {
    return [];
  }
}

/**
 * Mark an orphaned fee as confirmed after successful retry.
 */
export async function markFeeConfirmed(
  feeId: string,
  txHash: string
): Promise<void> {
  try {
    await prisma.feeLedger.update({
      where: { id: feeId },
      data: { feeOrphan: false, txHash },
    });
  } catch (error) {
    botLogger.error({ error: String(error) }, "fxaeonFees: mark confirmed failed");
  }
}

/**
 * For orphans that fail retry, we leave feeOrphan=true. After 3 total
 * reconciler passes, the poller stops retrying and an admin alert fires.
 */
export async function incrementFeeRetry(_feeId: string): Promise<void> {
  // With the current schema we don't have a retryCount column; the
  // reconciler tracks attempts in memory. This is a no-op stub that
  // keeps the interface stable for the poller.
}
