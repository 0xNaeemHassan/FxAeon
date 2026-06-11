/**
 * Position health monitor (W-12) — real liquidation warnings.
 *
 * Every 5 minutes, recompute health for all tracked positions and push:
 * - URGENT (≥ HEALTH_LEVELS.URGENT): always sent, bypasses prefs and quiet
 *   hours (a liquidation does not respect sleep schedules), 10-min throttle.
 * - WARNING (≥ HEALTH_LEVELS.WARNING): pref-gated, quiet-hours aware,
 *   30-min throttle.
 * Throttling/pref logic lives in the notify() gate, not here.
 */
import { prisma } from "@fxbot/db";
import { computeHealthPercent, HEALTH_LEVELS } from "@fxbot/shared";
import { notify } from "./notify.js";

const HEALTH_CHECK_INTERVAL_MS = 300_000; // 5 min

export function formatHealthMessage(
  level: "urgent" | "warning",
  pos: { market: string; side: string; tokenId: string; liquidationPrice: number },
  healthPercent: number
): string {
  const head = level === "urgent" ? "🔴 URGENT: liquidation risk" : "🟡 Position health warning";
  return (
    `${head}\n` +
    `${pos.market} ${pos.side} #${pos.tokenId} is at ${healthPercent.toFixed(1)}% of its liquidation threshold ` +
    `(liq. price ${pos.liquidationPrice}).\n` +
    `Consider adding collateral or reducing leverage.`
  );
}

export const healthMonitor = {
  async check(): Promise<void> {
    try {
      const positions = await prisma.position.findMany({
        include: { user: true },
      });

      for (const pos of positions) {
        const health = computeHealthPercent(pos.debtRatio);
        if (health >= HEALTH_LEVELS.URGENT) {
          await notify({
            userId: pos.userId,
            telegramId: pos.user.telegramId,
            kind: "health_urgent",
            message: formatHealthMessage("urgent", pos, health),
          });
        } else if (health >= HEALTH_LEVELS.WARNING) {
          await notify({
            userId: pos.userId,
            telegramId: pos.user.telegramId,
            kind: "health",
            message: formatHealthMessage("warning", pos, health),
          });
        }
      }
    } catch (error) {
      console.error("Health monitor error:", error);
    }
  },

  start(): void {
    setInterval(() => void this.check(), HEALTH_CHECK_INTERVAL_MS);
    console.log("Health monitor started (5min interval)");
  },
};
