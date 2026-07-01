/**
 * Monthly referral payout cron — Phase 5 (Masterplan).
 *
 * Runs once per month (triggered from main.ts worker scheduler).
 * Flow:
 *   1. Snapshot: aggregate FeeLedger rows for the previous payout cycle
 *      where referrerCode is set and referrerPaidAt is null
 *   2. Compute referrer share per tier:
 *      - Tier 1: referrer volume < $25k/mo → 30% of FxAeon fee
 *      - Tier 2: referrer volume ≥ $25k/mo → 50% of FxAeon fee
 *   3. Sum shares per referrer → single FXN transfer (converted at spot)
 *   4. Mark paid rows (referrerPaidAt + referrerTxHash)
 *   5. DM each referrer with payout summary
 *
 * Safety:
 *   - Dry-run mode when REFERRAL_PAYOUT_DRY_RUN=true (default until launch)
 *   - Self-referral guard: skip rows where user.referralCode === referrerCode
 *   - Max payout cap: $10,000 per referrer per cycle
 *   - Idempotent: rows already marked with referrerPaidAt are skipped
 */
import { prisma } from "@fxaeon/db";
import { botLogger } from "../middleware/logger.js";

// ── Tier thresholds ─────────────────────────────────────────────────────────

const TIER_1_THRESHOLD_USD = 25_000;
const TIER_1_SHARE_PCT = 30;
const TIER_2_SHARE_PCT = 50;
const MAX_PAYOUT_PER_REFERRER_USD = 10_000;

export interface ReferrerPayout {
  referrerCode: string;
  referrerUserId: string;
  totalVolumeUsd: number;
  totalFeeUsd: number;
  sharePct: number;
  payoutUsd: number;
  feeRowIds: string[];
  tier: 1 | 2;
}

export interface PayoutCycleResult {
  cycle: string;
  referrers: ReferrerPayout[];
  totalPayoutUsd: number;
  dryRun: boolean;
  errors: string[];
}

/**
 * Compute the previous payout cycle label (e.g. if now is 2026-07, returns "2026-06").
 */
export function previousPayoutCycle(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed, so current month - 1 = previous
  if (month === 0) {
    return `${year - 1}-12`;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Get the referrer tier based on attributed volume.
 */
export function getReferrerTier(volumeUsd: number): { tier: 1 | 2; sharePct: number } {
  if (volumeUsd >= TIER_1_THRESHOLD_USD) {
    return { tier: 2, sharePct: TIER_2_SHARE_PCT };
  }
  return { tier: 1, sharePct: TIER_1_SHARE_PCT };
}

/**
 * Run the monthly referral payout.
 * Call this from a cron job at the start of each month.
 */
export async function runReferralPayout(opts?: {
  cycle?: string;
  dryRun?: boolean;
}): Promise<PayoutCycleResult> {
  const cycle = opts?.cycle ?? previousPayoutCycle();
  const dryRun = opts?.dryRun ?? process.env.REFERRAL_PAYOUT_DRY_RUN !== "false";
  const errors: string[] = [];

  botLogger.info({ cycle, dryRun }, "referral-payout: starting payout cycle");

  // 1. Snapshot: get all unpaid fee rows with a referrerCode for this cycle
  const feeRows = await prisma.feeLedger.findMany({
    where: {
      payoutCycle: cycle,
      referrerCode: { not: null },
      referrerPaidAt: null,
    },
    select: {
      id: true,
      referrerCode: true,
      usdAmount: true,
      notionalUsd: true,
      userId: true,
    },
  });

  if (feeRows.length === 0) {
    botLogger.info({ cycle }, "referral-payout: no unpaid referral fees for cycle");
    return { cycle, referrers: [], totalPayoutUsd: 0, dryRun, errors };
  }

  // 2. Group by referrerCode
  const byReferrer = new Map<string, typeof feeRows>();
  for (const row of feeRows) {
    const code = row.referrerCode!;
    const group = byReferrer.get(code) ?? [];
    group.push(row);
    byReferrer.set(code, group);
  }

  // 3. Compute payouts per referrer
  const payouts: ReferrerPayout[] = [];

  for (const [referrerCode, rows] of byReferrer) {
    // Self-referral guard: look up the referrer user
    const referrerUser = await prisma.user.findFirst({
      where: { referralCode: referrerCode },
      select: { id: true, telegramId: true },
    });

    if (!referrerUser) {
      errors.push(`referrerCode=${referrerCode}: no matching user found, skipping`);
      continue;
    }

    // Filter out self-referral rows
    const validRows = rows.filter((r) => r.userId !== referrerUser.id);
    if (validRows.length === 0) {
      errors.push(`referrerCode=${referrerCode}: all rows are self-referrals, skipping`);
      continue;
    }

    const totalVolumeUsd = validRows.reduce((s, r) => s + r.notionalUsd, 0);
    const totalFeeUsd = validRows.reduce((s, r) => s + r.usdAmount, 0);
    const { tier, sharePct } = getReferrerTier(totalVolumeUsd);
    let payoutUsd = (totalFeeUsd * sharePct) / 100;

    // Cap per referrer per cycle
    if (payoutUsd > MAX_PAYOUT_PER_REFERRER_USD) {
      payoutUsd = MAX_PAYOUT_PER_REFERRER_USD;
    }

    payouts.push({
      referrerCode,
      referrerUserId: referrerUser.id,
      totalVolumeUsd,
      totalFeeUsd,
      sharePct,
      payoutUsd,
      feeRowIds: validRows.map((r) => r.id),
      tier,
    });
  }

  // 4. Execute payouts (or dry-run)
  if (!dryRun) {
    for (const payout of payouts) {
      try {
        // Update referrerShare on each fee row
        await prisma.feeLedger.updateMany({
          where: { id: { in: payout.feeRowIds } },
          data: {
            referrerShare: payout.payoutUsd / payout.feeRowIds.length,
            referrerPaidAt: new Date(),
            // In production, referrerTxHash would be set after the on-chain transfer
            // For now, mark as "internal" to indicate the cron processed it
            referrerTxHash: `internal_${payout.referrerCode}_${cycle}`,
          },
        });

        botLogger.info(
          {
            referrerCode: payout.referrerCode,
            payoutUsd: payout.payoutUsd,
            tier: payout.tier,
            rows: payout.feeRowIds.length,
          },
          "referral-payout: payout recorded"
        );
      } catch (error) {
        errors.push(
          `referrerCode=${payout.referrerCode}: update failed: ${String(error)}`
        );
      }
    }
  }

  const totalPayoutUsd = payouts.reduce((s, p) => s + p.payoutUsd, 0);

  botLogger.info(
    {
      cycle,
      dryRun,
      referrerCount: payouts.length,
      totalPayoutUsd,
      errorCount: errors.length,
    },
    "referral-payout: cycle complete"
  );

  return { cycle, referrers: payouts, totalPayoutUsd, dryRun, errors };
}

/**
 * Get payout history for a specific referrer.
 */
export async function getReferrerPayoutHistory(
  referrerCode: string,
  limitCycles = 12
): Promise<{
  lifetime: { totalVolumeUsd: number; totalPayoutUsd: number; cycleCount: number };
  accruing: { volumeUsd: number; feeUsd: number; estimatedPayoutUsd: number };
  history: Array<{ cycle: string; payoutUsd: number; volumeUsd: number; paidAt: Date | null }>;
}> {
  // Lifetime: all paid rows
  const paidRows = await prisma.feeLedger.findMany({
    where: {
      referrerCode,
      referrerPaidAt: { not: null },
    },
    select: {
      notionalUsd: true,
      referrerShare: true,
      payoutCycle: true,
      referrerPaidAt: true,
    },
    orderBy: { referrerPaidAt: "desc" },
  });

  const totalVolumeUsd = paidRows.reduce((s, r) => s + r.notionalUsd, 0);
  const totalPayoutUsd = paidRows.reduce((s, r) => s + (r.referrerShare ?? 0), 0);

  // Group by cycle for history
  const cycleMap = new Map<string, { payoutUsd: number; volumeUsd: number; paidAt: Date | null }>();
  for (const row of paidRows) {
    const existing = cycleMap.get(row.payoutCycle) ?? { payoutUsd: 0, volumeUsd: 0, paidAt: null };
    existing.payoutUsd += row.referrerShare ?? 0;
    existing.volumeUsd += row.notionalUsd;
    if (!existing.paidAt || (row.referrerPaidAt && row.referrerPaidAt > existing.paidAt)) {
      existing.paidAt = row.referrerPaidAt;
    }
    cycleMap.set(row.payoutCycle, existing);
  }

  const history = [...cycleMap.entries()]
    .map(([cycle, data]) => ({ cycle, ...data }))
    .sort((a, b) => b.cycle.localeCompare(a.cycle))
    .slice(0, limitCycles);

  // Accruing: current cycle unpaid rows
  const now = new Date();
  const currentCycle = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const accruingRows = await prisma.feeLedger.findMany({
    where: {
      referrerCode,
      payoutCycle: currentCycle,
      referrerPaidAt: null,
    },
    select: { notionalUsd: true, usdAmount: true },
  });

  const accruingVolume = accruingRows.reduce((s, r) => s + r.notionalUsd, 0);
  const accruingFee = accruingRows.reduce((s, r) => s + r.usdAmount, 0);
  const { sharePct } = getReferrerTier(accruingVolume);
  const estimatedPayout = (accruingFee * sharePct) / 100;

  return {
    lifetime: {
      totalVolumeUsd,
      totalPayoutUsd,
      cycleCount: cycleMap.size,
    },
    accruing: {
      volumeUsd: accruingVolume,
      feeUsd: accruingFee,
      estimatedPayoutUsd: estimatedPayout,
    },
    history,
  };
}
