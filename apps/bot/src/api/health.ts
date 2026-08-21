/**
 * Health endpoint v2 (W-15).
 *
 * Reports real dependency status (DB, Redis, RPC incl. chain-head lag),
 * background-worker heartbeats, and the in-process metrics snapshot.
 * Render polls this path — a failing DB makes the response 503 so Render
 * restarts/alerts instead of believing a hardcoded "healthy".
 */
import { Router } from "express";
import { prisma } from "@fxaeon/db";
import Redis from "ioredis";
import { withTimeout } from "../utils/resilience.js";
import {
  REQUIRED_WORKERS,
  classifyWorkerStatus,
  snapshot,
  type WorkerStatus,
} from "../core/metrics.js";
import { asyncHandler } from "../middleware/errors.js";
import { getRedisUrl } from "../utils/redisUrl.js";

const CHECK_TIMEOUT_MS = 3_000;
/** Chain head older than this ⇒ RPC (or chain view) considered stale. */
const RPC_LAG_DEGRADED_S = 60;
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

/**
 * Classify a Prisma/DB error into a short, secret-free hint that names the
 * usual production misconfigurations. `SELECT 1` succeeding while ORM
 * queries fail is exactly the Supabase-pooler trap, so the deep check now
 * exercises the same code path commands use (prisma.user.count()).
 */
export function classifyDbError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  const msg = e?.message ?? String(err);
  if (e?.code === "P2021" || /does not exist in the current database|relation .* does not exist/i.test(msg)) {
    return "schema-missing: tables not found — DATABASE_URL points at a database where migrations never ran";
  }
  if (/prepared statement .* (already exists|does not exist)/i.test(msg) || e?.code === "26000") {
    return "pgbouncer: transaction pooler without pgbouncer=true — add ?pgbouncer=true (and use port 6543) or switch to the session pooler (5432)";
  }
  if (e?.code === "P1000" || /authentication failed/i.test(msg)) {
    return "auth-failed: wrong DB password in DATABASE_URL";
  }
  if (e?.code === "P1001" || /can't reach database/i.test(msg)) {
    return "unreachable: host/port wrong or network blocked (Render⇄Supabase needs the IPv4 session pooler host)";
  }
  if (/timed out|timeout/i.test(msg)) {
    return "timeout: query exceeded health-check budget (pool exhausted or DB overloaded)";
  }
  // This hint is returned by a public endpoint. Unknown driver messages can
  // embed connection URLs, usernames, or provider tokens, so keep the public
  // fallback deliberately generic and rely on sanitized server logs instead.
  return "unknown: database check failed; inspect sanitized server logs";
}

let lastDbError: string | null = null;

async function checkDb(): Promise<"healthy" | "unhealthy"> {
  try {
    // ORM-level probe: raw `SELECT 1` can succeed while model queries fail
    // (missing schema, pgbouncer prepared-statement errors). Exercise the
    // exact path every command handler uses.
    await withTimeout(prisma.user.count(), CHECK_TIMEOUT_MS, "db health check");
    lastDbError = null;
    return "healthy";
  } catch (err) {
    lastDbError = classifyDbError(err);
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

type RpcHealth = {
  status: "healthy" | "degraded" | "unhealthy" | "skipped";
  headLagSeconds: number | null;
  chainId: number | null;
};

export async function checkRpc(
  url: string | undefined,
  label: "ethereum" | "base",
  expectedChainId: number,
  required = false
): Promise<RpcHealth> {
  if (!url) {
    return { status: required ? "unhealthy" : "skipped", headLagSeconds: null, chainId: null };
  }
  try {
    const rpcRequest = (method: string, params: unknown[], id: number) => fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id }),
    });
    const [headResponse, chainResponse] = await withTimeout(
      Promise.all([
        rpcRequest("eth_getBlockByNumber", ["latest", false], 1),
        rpcRequest("eth_chainId", [], 2),
      ]),
      CHECK_TIMEOUT_MS,
      `${label} rpc health check`
    );
    if (!headResponse.ok || !chainResponse.ok) {
      return { status: "degraded", headLagSeconds: null, chainId: null };
    }
    const [headJson, chainJson] = await Promise.all([
      headResponse.json() as Promise<{ result?: { timestamp?: string } }>,
      chainResponse.json() as Promise<{ result?: string }>,
    ]);
    const chainId = chainJson.result ? Number.parseInt(chainJson.result, 16) : null;
    if (chainId !== expectedChainId) {
      return { status: "unhealthy", headLagSeconds: null, chainId };
    }
    const ts = headJson.result?.timestamp;
    if (!ts) return { status: "degraded", headLagSeconds: null, chainId };
    const headLagSeconds = Math.max(0, Math.round(Date.now() / 1000 - parseInt(ts, 16)));
    return {
      status: headLagSeconds > RPC_LAG_DEGRADED_S ? "degraded" : "healthy",
      headLagSeconds,
      chainId,
    };
  } catch {
    return { status: "unhealthy", headLagSeconds: null, chainId: null };
  }
}

export const healthRouter = Router();

healthRouter.get("/", asyncHandler(async (_req, res) => {
  const start = Date.now();
  const bridgeRequested = (process.env.BRIDGE_EXECUTION_ENABLED ?? "false").toLowerCase() === "true";
  const [dbStatus, redisStatus, rpc, baseRpc] = await Promise.all([
    checkDb(),
    checkRedis(),
    checkRpc(process.env.ALCHEMY_RPC_URL, "ethereum", 1),
    checkRpc(process.env.BASE_RPC_URL, "base", 8453, bridgeRequested),
  ]);

  const metrics = snapshot([...REQUIRED_WORKERS]);
  const workers: Record<string, { lastBeatSecondsAgo: number | null; status: WorkerStatus }> = {};
  // Only enforce the required-worker SLA here. Optional low-frequency jobs
  // (notably the 24h SLO digest) also emit metrics, but applying an 11-minute
  // poller threshold to them would leave health permanently degraded.
  for (const name of REQUIRED_WORKERS) {
    const secondsAgo = metrics.workers[name] ?? null;
    workers[name] = {
      lastBeatSecondsAgo: secondsAgo,
      status: classifyWorkerStatus(secondsAgo, metrics.uptimeSeconds),
    };
  }

  // DB down ⇒ unhealthy (503 makes Render act). Everything else degrades.
  const degraded =
    redisStatus === "unhealthy" ||
    rpc.status === "unhealthy" ||
    rpc.status === "degraded" ||
    baseRpc.status === "unhealthy" ||
    baseRpc.status === "degraded" ||
    Object.values(workers).some((w) => w.status === "stale" || w.status === "not-started");
  const overall = dbStatus !== "healthy" ? "unhealthy" : degraded ? "degraded" : "healthy";

  res.status(overall === "unhealthy" ? 503 : 200).json({
    status: overall,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.3.0",
    responseTime: Date.now() - start,
    uptimeSeconds: metrics.uptimeSeconds,
    services: {
      database: dbStatus,
      // Secret-free root-cause hint for operators (null when healthy).
      databaseHint: lastDbError,
      redis: redisStatus,
      rpc: rpc.status,
      rpcChainId: rpc.chainId,
      rpcHeadLagSeconds: rpc.headLagSeconds,
      baseRpc: baseRpc.status,
      baseRpcChainId: baseRpc.chainId,
      baseRpcHeadLagSeconds: baseRpc.headLagSeconds,
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

/**
 * /health/deps — per-dependency status for Mini App degraded-chip display.
 * Returns a flat map: { db: "ok"|"degraded"|"down", redis: ..., rpc: ... }
 * so the Mini App can show a single chip per down/degraded dependency.
 */
healthRouter.get("/deps", asyncHandler(async (_req, res) => {
  type DepStatus = "ok" | "degraded" | "down";

  const bridgeRequested = (process.env.BRIDGE_EXECUTION_ENABLED ?? "false").toLowerCase() === "true";
  const [dbStatus, redisStatus, rpc, baseRpc] = await Promise.all([
    checkDb(),
    checkRedis(),
    checkRpc(process.env.ALCHEMY_RPC_URL, "ethereum", 1),
    checkRpc(process.env.BASE_RPC_URL, "base", 8453, bridgeRequested),
  ]);

  const dbDep: DepStatus = dbStatus === "healthy" ? "ok" : "down";
  const redisDep: DepStatus =
    redisStatus === "skipped" ? "ok" :
    redisStatus === "healthy" ? "ok" : "down";
  const rpcDep: DepStatus =
    rpc.status === "skipped" || rpc.status === "healthy" ? "ok" :
    rpc.status === "degraded" ? "degraded" : "down";
  const baseRpcDep: DepStatus =
    baseRpc.status === "skipped" || baseRpc.status === "healthy" ? "ok" :
    baseRpc.status === "degraded" ? "degraded" : "down";

  const overall: DepStatus =
    dbDep === "down" ? "down" :
    rpcDep === "down" || baseRpcDep === "down" ? "down" :
    rpcDep === "degraded" || baseRpcDep === "degraded" || redisDep === "down" ? "degraded" : "ok";

  res.json({
    overall,
    deps: { db: dbDep, redis: redisDep, rpc: rpcDep, baseRpc: baseRpcDep },
  });
}));
