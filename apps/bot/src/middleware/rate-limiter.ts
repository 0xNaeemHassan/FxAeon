import {
  RateLimiterRedis,
  RateLimiterMemory,
  RateLimiterRes,
  type RateLimiterAbstract,
} from "rate-limiter-flexible";
import Redis from "ioredis";
import { Request, Response, NextFunction } from "express";

// ── Build limiters ─────────────────────────────────────────
// Use Redis when REDIS_URL is available; fall back to in-memory otherwise.

function buildLimiters(): {
  global: RateLimiterAbstract;
  api: RateLimiterAbstract;
  webhook: RateLimiterAbstract;
  txCapClient: Redis | null;
} {
  if (process.env.REDIS_URL) {
    const redisClient = new Redis(process.env.REDIS_URL);
    return {
      global: new RateLimiterRedis({ storeClient: redisClient, keyPrefix: "middleware_global", points: 100, duration: 60 }),
      api: new RateLimiterRedis({ storeClient: redisClient, keyPrefix: "middleware_api", points: 60, duration: 60 }),
      webhook: new RateLimiterRedis({ storeClient: redisClient, keyPrefix: "middleware_webhook", points: 30, duration: 1 }),
      txCapClient: redisClient,
    };
  }
  // In-memory fallback (single-instance, fine for a single Render web service)
  return {
    global: new RateLimiterMemory({ keyPrefix: "middleware_global", points: 100, duration: 60 }),
    api: new RateLimiterMemory({ keyPrefix: "middleware_api", points: 60, duration: 60 }),
    webhook: new RateLimiterMemory({ keyPrefix: "middleware_webhook", points: 30, duration: 1 }),
    txCapClient: null,
  };
}

const limiters = buildLimiters();

export async function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const key = req.ip || "unknown";
  let limiter = limiters.global;
  if (req.path === "/webhook") limiter = limiters.webhook;
  else if (req.path.startsWith("/api/")) limiter = limiters.api;

  try {
    await limiter.consume(key);
    next();
  } catch (rejRes) {
    if (rejRes instanceof RateLimiterRes) {
      res.status(429).json({ error: "Too many requests", retryAfter: Math.round(rejRes.msBeforeNext / 1000) });
    } else {
      // Redis down or unexpected error — let the request through rather than blocking
      next();
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
      throw rejRes;
    }
  }

  // No Redis — allow all (cap enforced at DB level as a fallback)
  return { allowed: true, remaining: cap };
}
