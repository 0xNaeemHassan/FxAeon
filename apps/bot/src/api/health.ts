function safeJSONStringify(obj: any): string { try { return JSON.stringify(obj); } catch { return '{}'; } }
import { Router } from "express";
import { prisma } from "@fxbot/db";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

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
  let redisStatus = "healthy";
  try {
    await redis.ping();
  } catch (e) {
    redisStatus = "unhealthy";
  }
  
  // Check Alchemy RPC
  let rpcStatus = "healthy";
  try {
    const response = await fetch(process.env.ALCHEMY_RPC_URL!, {
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
  
  const overall = dbStatus === "healthy" && redisStatus === "healthy" ? "healthy" : "degraded";
  
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
