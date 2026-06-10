import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "@fxbot/db";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { simulateTrade } from "../fx/index.js";

const redis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

// Cast redis to avoid ioredis version mismatch between direct dep and bullmq's peer dep
export const ruleQueue = new Queue("fxbot-rules", { connection: redis as any });

export const ruleWorker = new Worker("fxbot-rules", async (job) => {
  const { ruleId } = job.data;
  
  const rule = await prisma.automationRule.findUnique({
    where: { id: ruleId },
    include: { user: true },
  });
  
  if (!rule || rule.status !== "active") return;
  
  // Conflict resolution: Redis SETNX lock
  const lockKey = `rule:lock:${rule.userId}:${rule.type}`;
  const lock = await redis.set(lockKey, ruleId, "EX", 60, "NX");
  if (!lock) {
    if (process.env.NODE_ENV !== "production") console.log(`Rule ${ruleId} skipped — another rule holds lock`);
    return;
  }
  
  try {
    const publicClient = createPublicClient({
      chain: mainnet,
      transport: http(process.env.ALCHEMY_RPC_URL!),
    });
    
    const simResult = await simulateTrade(
      publicClient,
      rule.user.walletAddress,
      "wstETH",
      "long",
      2,
      "1",
      rule.user.slippageBps
    );
    
    if (!simResult.success) {
      throw new Error(`Simulation failed: ${simResult.error}`);
    }
    
    // Execute via Privy delegated action
    // await executeRuleAction(rule);
    
    await prisma.automationRule.update({
      where: { id: ruleId },
      data: { lastRun: new Date(), failureCount: 0 },
    });
    
    await prisma.auditLog.create({
      data: {
        userId: rule.userId,
        action: "rule_executed",
        category: "automation",
        data: { ruleId, type: rule.type },
      },
    });
    
  } catch (err: unknown) {
    const newFailureCount = rule.failureCount + 1;
    const errorMessage = err instanceof Error ? err.message : String(err);
    
    if (newFailureCount >= 3) {
      await prisma.automationRule.update({
        where: { id: ruleId },
        data: { status: "failed", failureCount: newFailureCount },
      });
      console.error(`Rule "${rule.name}" paused after 3 failures: ${errorMessage}`);
    } else {
      const delay = newFailureCount === 1 ? 5 * 60 * 1000 : 30 * 60 * 1000;
      await prisma.automationRule.update({
        where: { id: ruleId },
        data: { failureCount: newFailureCount },
      });
      await ruleQueue.add("retry", { ruleId }, { delay });
    }
  } finally {
    await redis.del(lockKey);
  }
}, { connection: redis as any });

// Schedule cron-based rules
export async function scheduleRule(ruleId: string) {
  const rule = await prisma.automationRule.findUnique({ where: { id: ruleId } });
  if (!rule) return;
  
  if (rule.triggerSchedule) {
    await ruleQueue.add("cron", { ruleId: rule.id }, {
      repeat: { pattern: rule.triggerSchedule },
    });
  }
}

// Continuous watcher for price/health conditions
export async function startConditionWatcher() {
  setInterval(async () => {
    const activeRules = await prisma.automationRule.findMany({
      where: { status: "active" },
      include: { user: true },
    });
    
    for (const rule of activeRules) {
      if (rule.triggerPrice || rule.triggerHealth) {
        // Evaluate condition and add to queue if met
        // await ruleQueue.add("condition", { ruleId: rule.id });
      }
    }
  }, 60_000);
}
