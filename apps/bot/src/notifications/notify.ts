/**
 * The single pref-aware notification gate (W-12).
 *
 * ALL user-facing pushes go through notify() — nothing else may call
 * bot.api.sendMessage outside a command handler. The gate enforces:
 * - per-kind opt-in/out from NotificationPref (defaults match the schema),
 * - quiet hours (UTC "HH:MM" window, may wrap midnight) — bypassed only by
 *   urgent health alerts,
 * - per-kind throttling via the NotificationPref.last*Alert columns so a
 *   5-minute worker loop can't spam someone about the same sick position,
 * - timeout + retry + circuit breaker on the Telegram API,
 * - an AuditLog row written ONLY after Telegram confirmed delivery.
 *
 * Strings are plain English here; catalog wiring is W-21 (i18n).
 */
import { prisma } from "@fxbot/db";
import { withTimeout, withRetry, CircuitBreaker } from "../utils/resilience.js";

export type NotifyKind =
  | "tx"
  | "orders"
  | "health" // warning level — respects prefs/quiet hours/throttle
  | "health_urgent" // bypasses prefs and quiet hours; short throttle only
  | "rewards"
  | "governance"
  | "rules";

export type NotifyOutcome =
  | "sent"
  | "skipped:pref"
  | "skipped:quiet"
  | "skipped:throttle"
  | "skipped:uninitialized"
  | "failed";

interface NotifyParams {
  /** Internal DB user id. */
  userId: string;
  telegramId: string;
  kind: NotifyKind;
  message: string;
}

/** Pref column + throttle window per kind. */
const KIND_CONFIG: Record<
  NotifyKind,
  { prefField: "tx" | "orders" | "health" | "rewards" | "governance" | "rules" | null; lastField:
      | "lastTxAlert"
      | "lastOrderAlert"
      | "lastHealthAlert"
      | "lastRewardsAlert"
      | "lastGovernanceAlert"
      | "lastRulesAlert"; throttleMs: number; bypassQuietHours: boolean }
> = {
  tx: { prefField: "tx", lastField: "lastTxAlert", throttleMs: 0, bypassQuietHours: false },
  orders: { prefField: "orders", lastField: "lastOrderAlert", throttleMs: 0, bypassQuietHours: false },
  health: { prefField: "health", lastField: "lastHealthAlert", throttleMs: 30 * 60_000, bypassQuietHours: false },
  health_urgent: { prefField: null, lastField: "lastHealthAlert", throttleMs: 10 * 60_000, bypassQuietHours: true },
  rewards: { prefField: "rewards", lastField: "lastRewardsAlert", throttleMs: 60 * 60_000, bypassQuietHours: false },
  governance: { prefField: "governance", lastField: "lastGovernanceAlert", throttleMs: 60 * 60_000, bypassQuietHours: false },
  rules: { prefField: "rules", lastField: "lastRulesAlert", throttleMs: 0, bypassQuietHours: false },
};

/** Schema defaults — used when a user has no NotificationPref row. */
const PREF_DEFAULTS = { tx: true, orders: true, health: true, rewards: false, governance: false, rules: true };

type SendFn = (telegramId: string, message: string) => Promise<unknown>;
let sendFn: SendFn | null = null;
const telegramBreaker = new CircuitBreaker("telegram-api", 5, 60_000);

/** Wire the grammY bot in at startup: initNotify((id, msg) => bot.api.sendMessage(id, msg)). */
export function initNotify(fn: SendFn): void {
  sendFn = fn;
}

/** Is `now` inside the [start, end) quiet window? Window may wrap midnight. */
export function inQuietHours(start: string | null, end: string | null, now: Date = new Date()): boolean {
  if (!start || !end) return false;
  const parse = (s: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  };
  const s = parse(start);
  const e = parse(end);
  if (s === null || e === null || s === e) return false;
  const cur = now.getUTCHours() * 60 + now.getUTCMinutes();
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}

export async function notify(params: NotifyParams): Promise<NotifyOutcome> {
  const { userId, telegramId, kind, message } = params;
  if (!sendFn) return "skipped:uninitialized";

  const cfg = KIND_CONFIG[kind];
  const prefs = await prisma.notificationPref.findUnique({ where: { userId } });

  if (cfg.prefField) {
    const enabled = prefs ? prefs[cfg.prefField] : PREF_DEFAULTS[cfg.prefField];
    if (!enabled) return "skipped:pref";
  }
  if (!cfg.bypassQuietHours && prefs && inQuietHours(prefs.quietHoursStart, prefs.quietHoursEnd)) {
    return "skipped:quiet";
  }
  if (cfg.throttleMs > 0 && prefs) {
    const last = prefs[cfg.lastField];
    if (last && Date.now() - last.getTime() < cfg.throttleMs) return "skipped:throttle";
  }

  try {
    await telegramBreaker.run(() =>
      withRetry(() => withTimeout(sendFn!(telegramId, message), 10_000, "telegram sendMessage"), {
        attempts: 2,
        baseDelayMs: 500,
      })
    );
  } catch {
    return "failed";
  }

  // Delivery confirmed — record it (best effort; a logging failure must not
  // turn a delivered notification into an error path).
  try {
    if (prefs) {
      await prisma.notificationPref.update({
        where: { userId },
        data: { [cfg.lastField]: new Date() },
      });
    }
    await prisma.auditLog.create({
      data: { userId, action: "notification_sent", category: "notification", data: { kind, message } },
    });
  } catch {
    // swallow — see above
  }
  return "sent";
}

/** Test hooks. */
export function __resetNotifyForTests(): void {
  sendFn = null;
  telegramBreaker.__reset();
}
