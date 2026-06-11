/**
 * Limit-order fill poller (W-12).
 *
 * The old version polled `GET /v1/order?orderHash=` — an endpoint that does
 * not exist in the relay's OpenAPI spec — once per open order per 30s.
 * The real spec offers `GET /v1/order-updates?after=<unix>` exactly for this:
 * one incremental request returns every order that changed state since the
 * last poll. We diff that against our own open orders by orderHash.
 *
 * Relay execution.status: 0 New, 1 Partially filled, 2 Fully filled,
 * 3 Cancelled; `expired: true` marks expiry (neither cancelled nor filled).
 */
import { prisma } from "@fxbot/db";
import { heartbeat } from "../core/metrics.js";
import { workerLogger } from "../middleware/logger.js";
import { fetchOrderUpdates } from "../fx/limitOrders.js";
import { CircuitBreaker } from "../utils/resilience.js";
import { notify } from "./notify.js";

const POLL_INTERVAL_MS = 30_000;
/** First poll looks back 1h so a restart can't miss recent fills. */
const INITIAL_LOOKBACK_S = 3_600;

const relayBreaker = new CircuitBreaker("limit-order-relay", 5, 60_000);

interface OrderUpdate {
  orderHash?: string;
  execution?: { status?: number };
  expired?: boolean;
  updatedAt?: number;
}

export function mapRelayStatus(update: OrderUpdate): "filled" | "cancelled" | "expired" | null {
  if (update.execution?.status === 2) return "filled";
  if (update.execution?.status === 3) return "cancelled";
  if (update.expired === true) return "expired";
  return null; // New / partially filled — still open
}

let lastPollTs = Math.floor(Date.now() / 1000) - INITIAL_LOOKBACK_S;

export const limitOrderPolling = {
  async poll(): Promise<void> {
    heartbeat("limit-order-poller");
    try {
      const since = lastPollTs;
      const updates = (await relayBreaker.run(() => fetchOrderUpdates(since))) as OrderUpdate[];
      // Advance the cursor only after a successful fetch; overlap by 1s
      // beats missing an update on the boundary (DB updates are idempotent).
      lastPollTs = Math.max(since, ...updates.map((u) => u.updatedAt ?? 0), Math.floor(Date.now() / 1000) - 1);

      if (updates.length === 0) return;

      const hashes = updates.map((u) => u.orderHash).filter((h): h is string => typeof h === "string");
      if (hashes.length === 0) return;

      const ours = await prisma.limitOrder.findMany({
        where: { orderHash: { in: hashes }, status: "open" },
        include: { user: true },
      });
      const byHash = new Map(updates.map((u) => [u.orderHash, u]));

      for (const order of ours) {
        const update = byHash.get(order.orderHash);
        if (!update) continue;
        const newStatus = mapRelayStatus(update);
        if (!newStatus) continue;

        await prisma.limitOrder.update({
          where: { id: order.id },
          data: { status: newStatus, filledAt: newStatus === "filled" ? new Date() : undefined },
        });

        const text =
          newStatus === "filled"
            ? `✅ Limit order filled: ${order.orderSide ? "open" : "close"} on ${order.pool} @ trigger ${order.triggerPrice}`
            : newStatus === "cancelled"
              ? `🚫 Limit order cancelled on ${order.pool} (trigger ${order.triggerPrice})`
              : `⌛ Limit order expired on ${order.pool} (trigger ${order.triggerPrice})`;
        await notify({ userId: order.userId, telegramId: order.user.telegramId, kind: "orders", message: text });
      }
    } catch (error) {
      // Breaker-open and relay errors land here; next tick will retry/probe.
      console.error("Limit order polling error:", error);
    }
  },

  start(): void {
    setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    heartbeat("limit-order-poller");
    workerLogger.info("Limit order polling started (30s interval, incremental /v1/order-updates)");
  },
};

/** Test hook. */
export function __resetPollerForTests(ts?: number): void {
  lastPollTs = ts ?? Math.floor(Date.now() / 1000) - INITIAL_LOOKBACK_S;
  relayBreaker.__reset();
}
