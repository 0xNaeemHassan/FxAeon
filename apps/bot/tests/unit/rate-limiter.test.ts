/**
 * Rate limiter resilience (prod incident 2026-06-11).
 *
 * The Express rate limiter fronts EVERY route including /webhook. When Redis
 * was unreachable it hung each request ~20s and then failed webhook traffic
 * closed (503) — Telegram never got a 200, so the bot looked completely dead.
 * These tests pin the new behavior: bad REDIS_URL values are rejected up
 * front, and the middleware always answers fast via the in-memory backstop.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_REDIS_URL = process.env.REDIS_URL;

afterEach(() => {
  if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = ORIGINAL_REDIS_URL;
  vi.resetModules();
});

describe("getRedisUrl guard", () => {
  beforeEach(() => vi.resetModules());

  it("accepts redis:// and rediss:// URLs", async () => {
    process.env.REDIS_URL = "rediss://default:pw@host.upstash.io:6379";
    const { getRedisUrl } = await import("../../src/utils/redisUrl.js");
    expect(getRedisUrl()).toBe("rediss://default:pw@host.upstash.io:6379");
  });

  it("rejects the Upstash REST (https://) endpoint instead of letting ioredis hang on it", async () => {
    process.env.REDIS_URL = "https://host.upstash.io";
    const { getRedisUrl } = await import("../../src/utils/redisUrl.js");
    expect(getRedisUrl()).toBeUndefined();
  });

  it("returns undefined when REDIS_URL is unset", async () => {
    delete process.env.REDIS_URL;
    const { getRedisUrl } = await import("../../src/utils/redisUrl.js");
    expect(getRedisUrl()).toBeUndefined();
  });
});

describe("rateLimiter middleware (in-memory path)", () => {
  function mockReqRes(path: string, ip = "203.0.113.7") {
    const req = { path, ip } as any;
    const res = {
      statusCode: 0,
      body: undefined as unknown,
      status(code: number) { this.statusCode = code; return this; },
      json(payload: unknown) { this.body = payload; return this; },
    } as any;
    return { req, res };
  }

  it("passes webhook requests through quickly and 429s once the per-second budget is spent", async () => {
    delete process.env.REDIS_URL; // memory limiters
    vi.resetModules();
    const { rateLimiter } = await import("../../src/middleware/rate-limiter.js");

    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    let passed = 0;
    let limited = 0;
    const started = Date.now();
    // webhook limiter: 30 points / 1s
    for (let i = 0; i < 35; i++) {
      const { req, res } = mockReqRes("/webhook", ip);
      let nextCalled = false;
      await rateLimiter(req, res, () => { nextCalled = true; });
      if (nextCalled) passed++;
      else if (res.statusCode === 429) limited++;
    }
    expect(passed).toBe(30);
    expect(limited).toBe(5);
    // The whole batch must decide fast — no multi-second hangs.
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("never blocks non-webhook traffic on limiter trouble (fail open)", async () => {
    delete process.env.REDIS_URL;
    vi.resetModules();
    const { rateLimiter } = await import("../../src/middleware/rate-limiter.js");
    const { req, res } = mockReqRes("/health", "192.0.2.55");
    let nextCalled = false;
    await rateLimiter(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});
