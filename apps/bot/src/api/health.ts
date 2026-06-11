/**
 * Health endpoint v2 (W-15).
 *
 * Reports real dependency status (DB, Redis, RPC incl. chain-head lag),
 * background-worker heartbeats, and the in-process metrics snapshot.
 * Render polls this path — a failing DB makes the response 503 so Render
 * restarts/alerts instead of believing a hardcoded "healthy".
 */
import { Router } from "express";
import { prisma } from "@fxbot/db";
import Redis from "ioredis";
import { withTimeout } from "../utils/resilience.js";
import { snapshot } from "../core/metrics.js";
import { asyncHandler } from "../middleware/errors.js";
import { getRedisUrl } from "../utils/redisUrl.js";

const CHECK_TIMEOUT_MS = 3_000;
/** Chain head older than this ⇒ RPC (or chain view) considered stale. */
const RPC_LAG_DEGRADED_S = 60;
const KNOWN_WORKERS = ["health-monitor", "limit-order-poller"];
/** Worker silent longer than this ⇒ degraded (longest loop is 5 min). */
const WORKER_STALE_S = 11 * 60;

// Lazily create the Redis client on first health check, not at import time.
let redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (redis === undefined) {
    const redisUrl = getRedisUrl();
    redis = redisUrl
      ? new Redis(redisUrl, {
          lazyConnect: false,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          connectTimeout: 2_000,
          retryStrategy: (times) => Math.min(times * 500, 5_000),
        })
      : null;
    redis?.on("error", () => undefined); // reported via checkRedis(), don't crash on reconnect errors
  }
  return redis;
}

async function checkDb(): Promise<"healthy" | "unhealthy"> {
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, CHECK_TIMEOUT_MS, "db health check");
    return "healthy";
  } catch {
    return "unhealthy";
  }
}

async function checkRedis(): Promise<"healthy" | "unhealthy" | "skipped"> {
  const client = getRedis();
  if (!client) return "skipped";
  try {
    await withTimeout(client.ping(), CHECK_TIMEOUT_MS, "redis health check");
    return "healthy";
  } catch {
    return "unhealthy";
  }
}

async function checkRpc(): Promise<{ status: "healthy" | "degraded" | "unhealthy" | "skipped"; headLagSeconds: number | null }> {
  const url = process.env.ALCHEMY_RPC_URL;
  if (!url) return { status: "skipped", headLagSeconds: null };
  try {
    const response = await withTimeout(
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getBlockByNumber", params: ["latest", false], id: 1 }),
      }),
      CHECK_TIMEOUT_MS,
      "rpc health check"
    );
    if (!response.ok) return { status: "degraded", headLagSeconds: null };
    const json = (await response.json()) as { result?: { timestamp?: string } };
    const ts = json.result?.timestamp;
    if (!ts) return { status: "degraded", headLagSeconds: null };
    const headLagSeconds = Math.max(0, Math.round(Date.now() / 1000 - parseInt(ts, 16)));
    return { status: headLagSeconds > RPC_LAG_DEGRADED_S ? "degraded" : "healthy", headLagSeconds };
  } catch {
    return { status: "unhealthy", headLagSeconds: null };
  }
}

export const healthRouter = Router();

healthRouter.get("/", asyncHandler(async (_req, res) => {
  const start = Date.now();
  const [dbStatus, redisStatus, rpc] = await Promise.all([checkDb(), checkRedis(), checkRpc()]);

  const metrics = snapshot(KNOWN_WORKERS);
  const workers: Record<string, { lastBeatSecondsAgo: number | null; status: "healthy" | "stale" | "not-started" }> = {};
  for (const [name, secondsAgo] of Object.entries(metrics.workers)) {
    workers[name] = {
      lastBeatSecondsAgo: secondsAgo,
      status: secondsAgo === null ? "not-started" : secondsAgo > WORKER_STALE_S ? "stale" : "healthy",
    };
  }

  // DB down ⇒ unhealthy (503 makes Render act). Everything else degrades.
  const degraded =
    redisStatus === "unhealthy" ||
    rpc.status === "unhealthy" ||
    rpc.status === "degraded" ||
    Object.values(workers).some((w) => w.status === "stale");
  const overall = dbStatus !== "healthy" ? "unhealthy" : degraded ? "degraded" : "healthy";

  res.status(overall === "unhealthy" ? 503 : 200).json({
    status: overall,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.1.0",
    responseTime: Date.now() - start,
    uptimeSeconds: metrics.uptimeSeconds,
    services: {
      database: dbStatus,
      redis: redisStatus,
      rpc: rpc.status,
      rpcHeadLagSeconds: rpc.headLagSeconds,
    },
    workers,
    metrics: { counters: metrics.counters, timings: metrics.timings },
  });
}));

healthRouter.get("/ready", asyncHandler(async (_req, res) => {
  // Ready = can serve traffic = DB reachable.
  const db = await checkDb();
  res.status(db === "healthy" ? 200 : 503).json({ ready: db === "healthy" });
}));
