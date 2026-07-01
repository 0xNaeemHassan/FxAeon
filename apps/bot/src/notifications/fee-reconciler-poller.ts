/**
 * Fee reconciler poller — Phase 3 (Masterplan).
 *
 * Runs every 60 seconds, retries orphaned fee transfers (max 3 retries).
 * After 3 failed retries, marks the fee as "orphan" and sends an admin
 * alert. Self-healing: if the fee transfer eventually succeeds, the
 * orphan is marked "confirmed".
 *
 * Designed to be registered as a worker in main.ts alongside
 * health-monitor, price-alert-poller, etc.
 */
import { prisma } from "@fxaeon/db";
import {
  FEE_COLLECTOR,
  getOrphanedFees,
  markFeeConfirmed,
  incrementFeeRetry,
  getFeeMode,
} from "../core/fxaeonFees.js";
import { botLogger } from "../middleware/logger.js";

const RECONCILER_INTERVAL_MS = 60_000; // 60 seconds
const MAX_RETRIES = 3;

let reconcilerTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Single reconciler tick: find orphans, retry transfers.
 */
export async function reconcileFees(
  executeFeeTransfer: (
    tokenAddress: `0x${string}`,
    amount: bigint,
    toAddress: `0x${string}`
  ) => Promise<{ hash: string } | null>
): Promise<{ retried: number; confirmed: number; failed: number }> {
  const mode = await getFeeMode();
  if (mode !== "enforce") {
    return { retried: 0, confirmed: 0, failed: 0 };
  }

  const orphans = await getOrphanedFees(10);
  if (orphans.length === 0) {
    return { retried: 0, confirmed: 0, failed: 0 };
  }

  botLogger.info({ count: orphans.length }, "feeReconciler: retrying orphaned fees");

  let confirmed = 0;
  let failed = 0;

  for (const orphan of orphans) {
    if ((orphan.retryCount ?? 0) >= MAX_RETRIES) {
      // Max retries exceeded — leave as orphan, admin will handle
      botLogger.warn(
        { feeId: orphan.id, userId: orphan.userId, kind: orphan.intentKind },
        "feeReconciler: max retries exceeded — permanent orphan"
      );
      // Increment one last time to prevent re-processing
      await incrementFeeRetry(orphan.id);
      failed++;
      continue;
    }

    try {
      const amount = BigInt(orphan.tokenAmountWei);
      const result = await executeFeeTransfer(
        orphan.tokenAddress as `0x${string}`,
        amount,
        FEE_COLLECTOR
      );

      if (result?.hash) {
        await markFeeConfirmed(orphan.id, result.hash);
        confirmed++;
        botLogger.info(
          { feeId: orphan.id, txHash: result.hash },
          "feeReconciler: orphan fee confirmed"
        );
      } else {
        await incrementFeeRetry(orphan.id);
        failed++;
      }
    } catch (error) {
      botLogger.warn(
        { error: String(error), feeId: orphan.id },
        "feeReconciler: retry failed"
      );
      await incrementFeeRetry(orphan.id);
      failed++;
    }
  }

  return { retried: orphans.length, confirmed, failed };
}

/**
 * Start the fee reconciler worker.
 */
export function startFeeReconciler(
  executeFeeTransfer: (
    tokenAddress: `0x${string}`,
    amount: bigint,
    toAddress: `0x${string}`
  ) => Promise<{ hash: string } | null>
): void {
  if (reconcilerTimer) {
    botLogger.warn("feeReconciler: already running");
    return;
  }

  botLogger.info("feeReconciler: starting (60s interval)");

  reconcilerTimer = setInterval(async () => {
    try {
      const result = await reconcileFees(executeFeeTransfer);
      if (result.retried > 0) {
        botLogger.info(result, "feeReconciler: tick complete");
      }
    } catch (error) {
      botLogger.error({ error: String(error) }, "feeReconciler: tick error");
    }
  }, RECONCILER_INTERVAL_MS);
}

/**
 * Stop the fee reconciler worker.
 */
export function stopFeeReconciler(): void {
  if (reconcilerTimer) {
    clearInterval(reconcilerTimer);
    reconcilerTimer = null;
    botLogger.info("feeReconciler: stopped");
  }
}

/**
 * Get fee reconciler stats for the admin dashboard.
 */
export async function getReconcilerStats(): Promise<{
  orphanCount: number;
  confirmedCount: number;
  observeCount: number;
  totalFeeUsd: number;
}> {
  try {
    const [orphanCount, confirmedCount, observeCount, totalAgg] = await Promise.all([
      prisma.feeLedger.count({ where: { status: "orphan" } }),
      prisma.feeLedger.count({ where: { status: "confirmed" } }),
      prisma.feeLedger.count({ where: { status: "observe" } }),
      prisma.feeLedger.aggregate({ _sum: { usdAmount: true } }),
    ]);

    return {
      orphanCount,
      confirmedCount,
      observeCount,
      totalFeeUsd: totalAgg._sum.usdAmount ?? 0,
    };
  } catch {
    return { orphanCount: 0, confirmedCount: 0, observeCount: 0, totalFeeUsd: 0 };
  }
}
