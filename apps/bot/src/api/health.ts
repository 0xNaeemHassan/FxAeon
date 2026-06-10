function safeJSONStringify(obj: any): string { try { return JSON.stringify(obj); } catch { return '{}'; } }
import { Router } from "express";
import { prisma } from "@fxbot/db";
import Redis from "ioredis";

// Only create a Redis client if REDIS_URL is configured
const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL)
  : null;

export const healthRouter = Router();

healthRouter.get("/", async (req, res) => {
  const start = Date.now();
  
  // Check database
  let dbStatus = "healthy";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    dbStatus = "unhealthy";
  }
  
  // Check Redis
  let redisStatus = redis ? "healthy" : "skipped";
  if (redis) {
    try {
      await redis.ping();
    } catch (e) {
      redisStatus = "unhealthy";
    }
  }
  
  // Check Alchemy RPC
  let rpcStatus = process.env.ALCHEMY_RPC_URL ? "healthy" : "skipped";
  if (process.env.ALCHEMY_RPC_URL) {
    try {
      const response = await fetch(process.env.ALCHEMY_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: safeJSONStringify({
          jsonrpc: "2.0",
          method: "eth_blockNumber",
          params: [],
          id: 1,
        }),
      });
      if (!response.ok) rpcStatus = "degraded";
    } catch (e) {
      rpcStatus = "unhealthy";
    }
  }
  
  const overall = dbStatus === "healthy" ? "healthy" : "degraded";
  
  res.status(overall === "healthy" ? 200 : 503).json({
    status: overall,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.1.0",
    responseTime: Date.now() - start,
    services: {
      database: dbStatus,
      redis: redisStatus,
      rpc: rpcStatus,
    },
  });
});

healthRouter.get("/ready", async (req, res) => {
  res.json({ ready: true });
});
