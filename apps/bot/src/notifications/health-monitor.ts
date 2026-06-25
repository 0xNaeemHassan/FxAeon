/**
 * Position health monitor (W-12) — real liquidation warnings.
 *
 * Every 5 minutes, read every user's positions ON-CHAIN (the chain is the
 * source of truth — the old `prisma.position` table was never written, so
 * this worker silently never alerted) and push:
 * - URGENT (≥ HEALTH_LEVELS.URGENT): always sent, bypasses prefs and quiet
 *   hours (a liquidation does not respect sleep schedules), 10-min throttle.
 * - WARNING (≥ HEALTH_LEVELS.WARNING): pref-gated, quiet-hours aware,
 *   30-min throttle.
 * Throttling/pref logic lives in the notify() gate, not here.
 *
 * Failure honesty: a failed market/side read for a user is logged and
 * counted — we never alert (or stay silent) based on data we don't have.
 */
import { prisma } from "@fxaeon/db";
import { HEALTH_LEVELS } from "@fxaeon/shared";
import { createFxSdk } from "../fx/index.js";
import { fetchOnChainPositions, type OnChainPosition } from "../core/portfolio.js";
import { notify } from "./notify.js";
import { heartbeat, incr } from "../core/metrics.js";
import { workerLogger } from "../middleware/logger.js";

const HEALTH_CHECK_INTERVAL_MS = 300_000; // 5 min

export type HealthLevel = "urgent" | "warning";

/** Pure classification: health ratio (0–1+) → alert level or null. */
export function classifyHealth(health: number): HealthLevel | null {
  if (!Number.isFinite(health)) return null;
  if (health >= HEALTH_LEVELS.URGENT) return "urgent";
  if (health >= HEALTH_LEVELS.WARNING) return "warning";
  return null;
}

export function formatHealthMessage(
  level: HealthLevel,
  pos: Pick<OnChainPosition, "market" | "side" | "positionId" | "leverage" | "health">
): string {
  const head =
    level === "urgent"
      ? "🔴 URGENT: Rebalance Line breach imminent"
      : "🟡 Approaching the Rebalance Line";
  const tail =
    level === "urgent"
      ? "Crossing the Rebalance Line lets the protocol auto-sell part of your collateral to de-risk. Add collateral or reduce exposure NOW — /portfolio has a Close button."
      : "If your position crosses the Rebalance Line, the protocol can auto-sell part of your collateral. Add collateral or trim exposure — /portfolio has a Close button.";
  return (
    `${head}\n` +
    `${pos.market} ${pos.side.toUpperCase()} #${pos.positionId} (${pos.leverage.toFixed(2)}x) ` +
    `is at ${(pos.health * 100).toFixed(1)}% of its liquidation threshold.\n` +
    tail
  );
}

export const healthMonitor = {
  async check(): Promise<void> {
    heartbeat("health-monitor");
    incr("healthcheck.run");
    try {
      const users = await prisma.user.findMany({
        select: { id: true, telegramId: true, walletAddress: true },
      });
      const sdk = createFxSdk();

      for (const user of users) {
        if (!user.walletAddress) continue;
        try {
          const { positions, failures } = await fetchOnChainPositions(sdk, user.walletAddress);
          if (failures.length > 0) {
            incr("healthcheck.read_failures", failures.length);
            workerLogger.warn(
              { userId: user.id, failures },
              "Health monitor: partial on-chain read — skipping failed market/side combos"
            );
          }
          for (const pos of positions) {
            const level = classifyHealth(pos.health);
            if (!level) continue;
            await notify({
              userId: user.id,
              telegramId: user.telegramId,
              kind: level === "urgent" ? "health_urgent" : "health",
              message: formatHealthMessage(level, pos),
            });
          }
        } catch (error) {
          incr("healthcheck.user_errors");
          workerLogger.error({ error, userId: user.id }, "Health monitor: user check failed");
        }
      }
    } catch (error) {
      workerLogger.error({ error }, "Health monitor error");
    }
  },

  start(): void {
    setInterval(() => void this.check(), HEALTH_CHECK_INTERVAL_MS);
    heartbeat("health-monitor");
    workerLogger.info("Health monitor started (5min interval, on-chain reads)");
  },
};
