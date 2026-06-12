/**
 * Price-alert poller — evaluates one-shot /alert rules.
 *
 * Every 60s: if any alert is active, read the shared CoinGecko snapshot
 * (the same 45s in-process cache /price uses, so this adds at most ~1
 * upstream request per minute across ALL users and features) and fire
 * matching alerts through the notify() gate (kind "rules": pref-aware,
 * quiet-hours aware).
 *
 * Semantics:
 * - One-shot: an alert fires once, records the observed price, and flips
 *   to status=triggered. No re-arm, no spam.
 * - Crossing is evaluated against the CURRENT snapshot, not tick-by-tick:
 *   "above 65000" fires the first time we observe price ≥ threshold.
 * - A notify() outcome of "skipped:*"/"failed" does NOT consume the alert —
 *   it stays active and retries next cycle (quiet hours end, Telegram heals).
 * - Stale snapshots (upstream down, ≤10min old) are NOT used to fire alerts:
 *   acting on old prices is worse than waiting one cycle.
 */
import { prisma } from "@fxbot/db";
import { getMarketOverview, type MarketRow } from "../market/coingecko.js";
import { describeAlert } from "../commands/alert.js";
import { formatPrice } from "../commands/price.js";
import { notify } from "./notify.js";
import { heartbeat, incr } from "../core/metrics.js";
import { workerLogger } from "../middleware/logger.js";

const POLL_INTERVAL_MS = 60_000;

export interface AlertRecord {
  id: string;
  userId: string;
  symbol: string;
  kind: string; // above | below | pct
  threshold: number;
}

/** Pure trigger predicate — exported for tests. */
export function shouldTrigger(alert: AlertRecord, row: MarketRow | undefined): number | null {
  if (!row?.data) return null;
  const { priceUsd, change24hPct } = row.data;

  if (alert.kind === "above") return priceUsd >= alert.threshold ? priceUsd : null;
  if (alert.kind === "below") return priceUsd <= alert.threshold ? priceUsd : null;
  if (alert.kind === "pct") {
    if (change24hPct === null) return null;
    if (alert.threshold > 0 && change24hPct >= alert.threshold) return priceUsd;
    if (alert.threshold < 0 && change24hPct <= alert.threshold) return priceUsd;
    return null;
  }
  return null;
}

export function formatAlertMessage(
  alert: AlertRecord,
  observedPrice: number,
  change24hPct: number | null
): string {
  const changeLine =
    change24hPct === null ? "" : ` (24h ${change24hPct >= 0 ? "+" : ""}${change24hPct.toFixed(2)}%)`;
  return (
    `🔔 Price alert: ${describeAlert(alert)}\n` +
    `${alert.symbol} is now ${formatPrice(observedPrice)}${changeLine}.\n` +
    `This alert fired once and is archived. Set a new one with /alert`
  );
}

export const priceAlertPoller = {
  async check(): Promise<void> {
    heartbeat("price-alert-poller");
    try {
      const alerts = await prisma.priceAlert.findMany({
        where: { status: "active" },
        include: { user: { select: { telegramId: true } } },
      });
      if (alerts.length === 0) return;

      const overview = await getMarketOverview();
      if (overview.stale) {
        // Old prices must not fire alerts; wait for a fresh snapshot.
        incr("price_alerts.skipped_stale");
        return;
      }
      const bySymbol = new Map(overview.rows.map((r) => [r.symbol, r]));

      for (const alert of alerts) {
        const row = bySymbol.get(alert.symbol);
        const observed = shouldTrigger(alert, row);
        if (observed === null) continue;

        const outcome = await notify({
          userId: alert.userId,
          telegramId: alert.user.telegramId,
          kind: "rules",
          message: formatAlertMessage(alert, observed, row?.data?.change24hPct ?? null),
        });

        // Consume the alert only after a real delivery — skipped (quiet
        // hours/prefs) or failed sends keep it active for the next cycle.
        if (outcome === "sent") {
          await prisma.priceAlert.update({
            where: { id: alert.id },
            data: { status: "triggered", triggeredAt: new Date(), triggerPrice: observed },
          });
          incr("price_alerts.fired");
        }
      }
    } catch (err) {
      // CoinGecko down with no cache, or DB hiccup — log and retry next cycle.
      workerLogger.error({ err }, "price-alert-poller cycle failed");
    }
  },

  start(): NodeJS.Timeout {
    const timer = setInterval(() => void this.check(), POLL_INTERVAL_MS);
    timer.unref?.();
    workerLogger.info("price-alert poller started (60s interval)");
    return timer;
  },
};
