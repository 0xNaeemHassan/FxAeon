/**
 * Admin error alerts: every unexpected error gets a short ID, and the full
 * (sanitized) details are pushed to ADMIN_TELEGRAM_CHAT_ID so the operator
 * can debug production without Render log access.
 *
 * Design rules:
 * - Fail-soft: alerting must NEVER throw into the calling path. Errors here
 *   are swallowed after a log line.
 * - No secrets: messages are scrubbed of anything that looks like a key,
 *   token, password or connection-string credential before sending.
 * - No spam: identical error signatures are deduped within a 5-minute
 *   window (first occurrence sends; repeats are counted and the count is
 *   included the next time the same signature sends).
 * - Decoupled from grammY: wired with a sendFn from main.ts, same pattern
 *   as notify()/sloDigest — unit-testable without a live bot.
 */
import { logger } from "../middleware/logger.js";

type SendFn = (chatId: string, message: string) => Promise<unknown>;

let sendFn: SendFn | null = null;
let adminChatId: string | undefined;

const DEDUPE_WINDOW_MS = 5 * 60_000;
const MAX_STACK_LINES = 8;
const MAX_MESSAGE_CHARS = 3500; // Telegram hard limit is 4096

const recentSignatures = new Map<string, { lastSent: number; suppressed: number }>();

/** Strip credentials and key-shaped strings from text before it leaves the box. */
export function scrubSensitive(text: string): string {
  return (
    text
      // URL credentials: scheme://user:pass@host → scheme://***@host
      .replace(/(\w+:\/\/)([^/\s:@]+):([^/\s@]+)@/g, "$1***@")
      // Bearer / token-like assignments
      .replace(/((?:api[-_]?key|token|secret|password|authorization)["'\s:=]+)[\w.\-+/=]{8,}/gi, "$1***")
      // Long hex blobs (private keys, signatures) — keep 0x prefix + 6 chars
      .replace(/0x[0-9a-fA-F]{40,}/g, (m) => `${m.slice(0, 8)}…[scrubbed]`)
  );
}

/** Short, human-quotable error ID (also returned to the user in error copy). */
export function newErrorId(): string {
  return `E-${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

export function initAdminAlerts(fn: SendFn, chatId: string | undefined): void {
  sendFn = fn;
  adminChatId = chatId;
}

/** Test hook. */
export function resetAdminAlerts(): void {
  sendFn = null;
  adminChatId = undefined;
  recentSignatures.clear();
}

/**
 * Report an error to the admin chat. Returns the error ID (always, even when
 * the alert is skipped/deduped) so callers can include it in user-facing copy.
 */
export function reportErrorToAdmin(
  err: unknown,
  context: { source: string; command?: string; telegramId?: string; updateId?: number }
): string {
  const errorId = newErrorId();
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    const stackLines = (e.stack ?? "").split("\n").slice(0, MAX_STACK_LINES).join("\n");
    const signature = `${context.source}|${e.name}|${e.message.slice(0, 120)}`;

    // Structured log first — visible in Render logs regardless of Telegram.
    logger.error(
      { errorId, err: e, ...context },
      `[${errorId}] ${context.source} error`
    );

    if (!sendFn || !adminChatId) return errorId;

    const now = Date.now();
    const seen = recentSignatures.get(signature);
    if (seen && now - seen.lastSent < DEDUPE_WINDOW_MS) {
      seen.suppressed += 1;
      return errorId;
    }
    const suppressedNote =
      seen && seen.suppressed > 0 ? `\n(+${seen.suppressed} duplicate(s) suppressed since last alert)` : "";
    recentSignatures.set(signature, { lastSent: now, suppressed: 0 });

    const parts = [
      `🚨 Bot error ${errorId}`,
      `source: ${context.source}` +
        (context.command ? ` (/${context.command})` : "") +
        (context.telegramId ? `\nuser: ${context.telegramId}` : ""),
      `${e.name}: ${e.message}`,
      stackLines,
    ];
    const message = scrubSensitive(parts.filter(Boolean).join("\n\n") + suppressedNote).slice(
      0,
      MAX_MESSAGE_CHARS
    );

    // Fire and forget — never block or throw into the update path.
    void sendFn(adminChatId, message).catch((sendError: unknown) => {
      logger.warn({ err: sendError, errorId }, "admin error alert failed to send");
    });
  } catch (alertError) {
    logger.warn({ err: alertError, errorId }, "admin error alert failed to build");
  }
  return errorId;
}
