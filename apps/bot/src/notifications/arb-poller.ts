import { prisma } from "@fxaeon/db";
import { getFxusdArbSnapshot, formatArbSnapshot } from "../market/arb.js";
import { notify } from "./notify.js";
import { heartbeat } from "../core/metrics.js";
import { workerLogger } from "../middleware/logger.js";

/**
 * NAV-vs-market arbitrage poller.
 *
 * Every 5 min: compute the fxUSD NAV-vs-secondary-market signal ONCE (shared
 * CoinGecko snapshot — no extra upstream cost). If an actionable arbitrage
 * exists, push it to every user who opted in (`arb` pref, default OFF). The
 * notify() gate enforces the 30-min per-user throttle (lastArbAlert) and quiet
 * hours, so we never spam — a persistent arb fires at most once per 30 min.
 */
const POLL_INTERVAL_MS = 5 * 60_000;

export const arbPoller = {
  async check(): Promise<void> {
    heartbeat("arb-poller");
    let snap;
    try {
      snap = await getFxusdArbSnapshot();
    } catch (e) {
      workerLogger.warn({ error: String(e) }, "arb-poller: snapshot failed");
      return;
    }
    if (!snap || !snap.signal.actionable) return;

    let users: Array<{ id: string; telegramId: string | null }>;
    try {
      // Only users who opted in — avoids loading the whole table.
      users = await prisma.user.findMany({
        where: { notifications: { is: { arb: true } } },
        select: { id: true, telegramId: true },
      });
    } catch (e) {
      workerLogger.warn({ error: String(e) }, "arb-poller: user query failed");
      return;
    }

    const message = formatArbSnapshot(snap);
    for (const user of users) {
      if (!user.telegramId) continue;
      try {
        await notify({ userId: user.id, telegramId: user.telegramId, kind: "arb", message });
      } catch (e) {
        workerLogger.warn({ error: String(e), userId: user.id }, "arb-poller: notify failed");
      }
    }
  },

  start(): NodeJS.Timeout {
    const timer = setInterval(() => void this.check(), POLL_INTERVAL_MS);
    workerLogger.info("Arb poller started (5m interval)");
    return timer;
  },
};
