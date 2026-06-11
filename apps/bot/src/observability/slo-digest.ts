/**
 * Daily SLO digest (W-15) — one Telegram message per day to the operator.
 *
 * Only runs when ADMIN_TELEGRAM_CHAT_ID is configured. Sends directly via
 * the provided send function (NOT the user-pref notify() gate — this is an
 * operator channel, prefs/quiet-hours don't apply).
 * Metrics are in-process, so the digest covers the window since the last
 * restart if the process restarted — the message says so honestly.
 */
import { logger } from "../middleware/logger.js";
import { snapshot, heartbeat } from "../core/metrics.js";
import { withRetry, withTimeout } from "../utils/resilience.js";

const DIGEST_INTERVAL_MS = 24 * 60 * 60 * 1000;
const KNOWN_WORKERS = ["health-monitor", "limit-order-poller"];

export function formatDigest(now = new Date()): string {
  const m = snapshot(KNOWN_WORKERS);
  const lines: string[] = [
    `📊 FxAeon daily digest — ${now.toISOString().slice(0, 10)}`,
    `Uptime: ${(m.uptimeSeconds / 3600).toFixed(1)}h (metrics cover this window only)`,
  ];

  const cmds = Object.entries(m.counters)
    .filter(([k]) => k.startsWith("cmd.") && !k.endsWith(".error"))
    .sort((a, b) => b[1] - a[1]);
  const totalCmds = cmds.reduce((s, [, v]) => s + v, 0);
  const errors = Object.entries(m.counters)
    .filter(([k]) => k.endsWith(".error"))
    .reduce((s, [, v]) => s + v, 0);
  lines.push(`Commands: ${totalCmds} handled, ${errors} errors`);
  for (const [k, v] of cmds.slice(0, 5)) {
    const t = m.timings[k];
    lines.push(`  /${k.slice(4)}: ${v}× ${t ? `(p95 ${t.p95}ms)` : ""}`.trimEnd());
  }

  const simOk = m.counters["simulate.ok"] ?? 0;
  const simRevert = m.counters["simulate.revert"] ?? 0;
  if (simOk + simRevert > 0) lines.push(`Simulations: ${simOk} ok, ${simRevert} reverted`);

  const notifSent = m.counters["notify.sent"] ?? 0;
  const notifFailed = m.counters["notify.failed"] ?? 0;
  if (notifSent + notifFailed > 0) lines.push(`Notifications: ${notifSent} sent, ${notifFailed} failed`);

  const workerBits = Object.entries(m.workers).map(([w, s]) =>
    s === null ? `${w}: never ran ⚠️` : s > 11 * 60 ? `${w}: stale (${Math.round(s / 60)}m) ⚠️` : `${w}: ok`
  );
  lines.push(`Workers: ${workerBits.join(", ")}`);
  return lines.join("\n");
}

export const sloDigest = {
  start(send: (chatId: string, message: string) => Promise<unknown>): void {
    const chatId = process.env.ADMIN_TELEGRAM_CHAT_ID;
    if (!chatId) {
      logger.info("ADMIN_TELEGRAM_CHAT_ID not set — daily SLO digest disabled");
      return;
    }
    const run = async () => {
      heartbeat("slo-digest");
      try {
        await withRetry(() => withTimeout(send(chatId, formatDigest()), 10_000, "slo digest send"), {
          attempts: 2,
          baseDelayMs: 2_000,
        });
        logger.info("SLO digest sent");
      } catch (error) {
        logger.error({ error }, "SLO digest failed");
      }
    };
    setInterval(() => void run(), DIGEST_INTERVAL_MS);
    logger.info("Daily SLO digest scheduled (24h interval)");
  },
};
