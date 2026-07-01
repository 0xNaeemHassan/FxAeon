/**
 * Redis-backed callback keys for multi-position pickers.
 *
 * Phase 2 (Masterplan): Telegram's callback_data is limited to 64 bytes.
 * Instead of cramming position details into it, we store the payload in
 * Redis under a short nonce key (`cb:<10-char nonce>`) with a 10-minute TTL.
 * The callback_data carries only the nonce.
 *
 * This pattern works for:
 * - Position close pickers
 * - Position action menus (increase/reduce/adjust leverage)
 * - Trade intent confirmations with rich metadata
 */
import { randomBytes } from "node:crypto";
import { botLogger } from "../middleware/logger.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface CallbackPayload {
  /** Action type */
  action: string;
  /** Market */
  market?: string;
  /** Position side */
  side?: string;
  /** Position ID */
  positionId?: number;
  /** Size in basis points (25% = 2500) */
  sizeBps?: number;
  /** Additional data */
  [key: string]: unknown;
}

const CALLBACK_TTL_SECONDS = 600; // 10 minutes
const KEY_PREFIX = "cb:";

// ── In-memory store (Redis upgrade path ready) ──────────────────────────────
// For now we use a Map with TTL cleanup. When Redis is available, swap the
// get/set/del calls to use the Redis client.

const store = new Map<string, { payload: CallbackPayload; expiresAt: number }>();

/** Periodic cleanup of expired entries (runs every 60s). */
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function ensureCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.expiresAt) store.delete(key);
    }
  }, 60_000);
  // Don't keep the process alive just for cleanup
  if (cleanupInterval.unref) cleanupInterval.unref();
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Store a callback payload and return a short nonce for callback_data.
 * The nonce is 10 hex chars (5 random bytes) — fits easily in 64-byte budget.
 */
export function storeCallbackPayload(payload: CallbackPayload): string {
  ensureCleanup();
  const nonce = randomBytes(5).toString("hex"); // 10 chars
  const key = `${KEY_PREFIX}${nonce}`;
  store.set(key, {
    payload,
    expiresAt: Date.now() + CALLBACK_TTL_SECONDS * 1000,
  });
  botLogger.debug({ nonce, action: payload.action }, "callbackKeys: stored");
  return nonce;
}

/**
 * Retrieve and delete a callback payload by nonce.
 * Returns null if expired or not found.
 */
export function consumeCallbackPayload(nonce: string): CallbackPayload | null {
  const key = `${KEY_PREFIX}${nonce}`;
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  store.delete(key);
  return entry.payload;
}

/**
 * Peek at a callback payload without consuming it.
 */
export function peekCallbackPayload(nonce: string): CallbackPayload | null {
  const key = `${KEY_PREFIX}${nonce}`;
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.payload;
}

/** Number of active (non-expired) callback keys. For /stats. */
export function callbackKeyCount(): number {
  const now = Date.now();
  let count = 0;
  for (const entry of store.values()) {
    if (now <= entry.expiresAt) count++;
  }
  return count;
}
