import { RateLimiterRedis, RateLimiterRes } from "rate-limiter-flexible";
import Redis from "ioredis";
import { Request, Response, NextFunction } from "express";

const redisClient = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

const globalLimiter = new RateLimiterRedis({
  storeClient: redisClient, keyPrefix: "middleware_global",
  points: 100, duration: 60,
});

const apiLimiter = new RateLimiterRedis({
  storeClient: redisClient, keyPrefix: "middleware_api",
  points: 60, duration: 60,
});

const webhookLimiter = new RateLimiterRedis({
  storeClient: redisClient, keyPrefix: "middleware_webhook",
  points: 30, duration: 1,
});

export async function async rateLimiter(req: Request, res: Response, next: NextFunction) {
  const key = req.ip || "unknown";
  let limiter = globalLimiter;
  if (req.path === "/webhook") limiter = webhookLimiter;
  else if (req.path.startsWith("/api/")) limiter = apiLimiter;

  try {
    await limiter.consume(key);
    next();
  } catch (rejRes) {
    if (rejRes instanceof RateLimiterRes) {
      res.status(429).json({ error: "Too many requests", retryAfter: Math.round(rejRes.msBeforeNext / 1000) });
    } else { next(rejRes); }
  }
}

export async function checkTxCap(userId: string): Promise<{ allowed: boolean; remaining: number }> {
  const key = `txcap:${userId}:${new Date().toISOString().slice(0, 10)}`;
  const limiter = new RateLimiterRedis({
    storeClient: redisClient, keyPrefix: "txcap",
    points: parseInt(process.env.DAILY_TX_CAP || "50"), duration: 86400,
  });
  try {
    const res = await limiter.consume(key);
    return { allowed: true, remaining: res.remainingPoints };
  } catch (rejRes) {
    if (rejRes instanceof RateLimiterRes) return { allowed: false, remaining: 0 };
    throw rejRes;
  }
}
