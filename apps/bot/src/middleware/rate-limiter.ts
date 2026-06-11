import {
  RateLimiterRedis,
  RateLimiterMemory,
  RateLimiterRes,
  type RateLimiterAbstract,
} from "rate-limiter-flexible";
import Redis from "ioredis";
import { Request, Response, NextFunction } from "express";
import { logger } from "./logger.js";
import { getRedisUrl } from "../utils/redisUrl.js";

// How long a single limiter decision may take before we use the in-memory
// fallback instead. Telegram webhooks time out (and retry) when we stall, so
// a slow Redis must never block request handling.
const LIMITER_DECISION_TIMEOUT_MS = 250;

// ── Build limiters ─────────────────────────────────────────
// Use Redis when REDIS_URL is available; fall back to in-memory otherwise.
//
// PROD INCIDENT (2026-06-11): the previous defaults hung every request when
// Redis was unreachable. ioredis by default retries forever AND queues
// commands while offline ("offline queue"), so `limiter.consume()` neither
// resolved nor rejected for ~20s+ per request. Express middleware runs before
// EVERY route — including /webhook — so Telegram never got a 200 back and the
// bot appeared completely dead (/start returned nothing) even though the
// process was "up". The settings below make Redis failures fail FAST, and the
// middleware races each decision against a timeout with an in-memory backstop
// limiter, so a dead Redis degrades rate-limit accuracy instead of taking the
// bot down with it.

function buildMemoryLimiters() {
  return {
    global: new RateLimiterMemory({ keyPrefix: "middleware_global", points: 100, duration: 60 }),
    api: new RateLimiterMemory({ keyPrefix: "middleware_api", points: 60, duration: 60 }),
    webhook: new RateLimiterMemory({ keyPrefix: "middleware_webhook", points: 30, duration: 1 }),
  };
}

// In-memory backstop: used when Redis is absent, slow, or down. Single
// instance on Render, so memory limits are still meaningful.
const memoryLimiters = buildMemoryLimiters();

function buildLimiters(): {
  global: RateLimiterAbstract;
  api: RateLimiterAbstract;
  webhook: RateLimiterAbstract;
  txCapClient: Redis | null;
} {
  const redisUrl = getRedisUrl();
  if (redisUrl) {
    const redisClient = new Redis(redisUrl, {
      // Fail fast instead of hanging: don't queue commands while
      // disconnected, give up on a command after one retry, and cap how long
      // the initial connect may take.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      // Keep trying to reconnect in the background (cheap, capped at 5s) so
      // Redis limits resume automatically when it comes back.
      retryStrategy: (times) => Math.min(times * 500, 5_000),
    });
    redisClient.on("error", (err) => {
      // ioredis emits 'error' on every failed reconnect attempt; without a
      // listener those become unhandled-error crashes. Log once per state
      // change at most would be nicer, but warn-level spam is acceptable.
      logger.warn({ err: err.message }, "rate-limiter redis error (using in-memory fallback)");
    });
    return {
      global: new RateLimiterRedis({ storeClient: redisClient, keyPrefix: "middleware_global", points: 100, duration: 60, insuranceLimiter: memoryLimiters.global }),
      api: new RateLimiterRedis({ storeClient: redisClient, keyPrefix: "middleware_api", points: 60, duration: 60, insuranceLimiter: memoryLimiters.api }),
      webhook: new RateLimiterRedis({ storeClient: redisClient, keyPrefix: "middleware_webhook", points: 30, duration: 1, insuranceLimiter: memoryLimiters.webhook }),
      txCapClient: redisClient,
    };
  }
  // In-memory fallback (single-instance, fine for a single Render web service)
  return { ...memoryLimiters, txCapClient: null };
}

const limiters = buildLimiters();

class LimiterTimeout extends Error {}

/** Race a limiter decision against a hard deadline. */
function consumeWithDeadline(limiter: RateLimiterAbstract, key: string): Promise<unknown> {
  return Promise.race([
    limiter.consume(key),
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new LimiterTimeout()), LIMITER_DECISION_TIMEOUT_MS).unref()
    ),
  ]);
}

export async function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const key = req.ip || "unknown";
  const isWebhook =
    req.path === "/webhook" || req.path === "/privy-webhook" || req.path.startsWith("/api/webhook");
  const kind: "webhook" | "api" | "global" = isWebhook
    ? "webhook"
    : req.path.startsWith("/api/")
      ? "api"
      : "global";

  try {
    await consumeWithDeadline(limiters[kind], key);
    next();
  } catch (rejRes) {
    if (rejRes instanceof RateLimiterRes) {
      res.status(429).json({ error: "Too many requests", retryAfter: Math.round(rejRes.msBeforeNext / 1000) });
      return;
    }
    // Redis decision failed or took too long — decide with the in-memory
    // backstop instead. Traffic stays metered (single instance), and webhook
    // handling keeps its ~sub-second latency budget so Telegram doesn't time
    // out and mark the bot dead.
    try {
      await memoryLimiters[kind].consume(key);
      next();
    } catch (memRej) {
      if (memRej instanceof RateLimiterRes) {
        res.status(429).json({ error: "Too many requests", retryAfter: Math.round(memRej.msBeforeNext / 1000) });
      } else if (isWebhook) {
        // Fail CLOSED on webhook paths only if even the in-memory limiter
        // errors (should be unreachable). Telegram retries with backoff.
        res.status(503).json({ error: "Rate limiter unavailable" });
      } else {
        next();
      }
    }
  }
}

export async function checkTxCap(userId: string): Promise<{ allowed: boolean; remaining: number }> {
  const cap = parseInt(process.env.DAILY_TX_CAP || "50");
  const key = `txcap:${userId}:${new Date().toISOString().slice(0, 10)}`;

  if (limiters.txCapClient) {
    const limiter = new RateLimiterRedis({
      storeClient: limiters.txCapClient, keyPrefix: "txcap",
      points: cap, duration: 86400,
    });
    try {
      const res = await limiter.consume(key);
      return { allowed: true, remaining: res.remainingPoints };
    } catch (rejRes) {
      if (rejRes instanceof RateLimiterRes) return { allowed: false, remaining: 0 };
      // Redis down/slow: same posture as "no Redis configured" — allow and
      // rely on the DB-level cap, instead of breaking trading entirely.
      logger.warn({ err: rejRes instanceof Error ? rejRes.message : String(rejRes) }, "tx-cap redis unavailable — allowing (DB cap still applies)");
      return { allowed: true, remaining: cap };
    }
  }

  // No Redis — allow all (cap enforced at DB level as a fallback)
  return { allowed: true, remaining: cap };
}
