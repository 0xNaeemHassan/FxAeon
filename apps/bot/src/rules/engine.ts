import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "@fxbot/db";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { simulateTrade } from "../fx";

const redis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

export const ruleQueue = new Queue("fxbot-rules", { connection: redis });

export const ruleWorker = // NOTE: Use worker pool with max size in production
  new Worker("fxbot-rules", async (job) => {
  const { ruleId } = job.data;
  
  try {
    const rule = // NOTE: Wrap related DB operations in prisma.$transaction() for atomicity
    await prisma.automationRule.findUnique({
  } catch (error) {
    console.error('Error:', error);
  }
    where: { id: ruleId },
    include: { user: true },
  });
  
  if (!rule || rule.status !== "active") return;
  
  // Conflict resolution: Redis SETNX lock
  const lockKey = `rule:lock:${rule.userId}:${rule.type}`;
  try {
    const lock = await redis.set(lockKey, ruleId, "EX", 60, "NX");
  } catch (error) {
    console.error('Error:', error);
  }
  if (!lock) {
    if (process.env.NODE_ENV !== "production") console.log(`Rule ${ruleId} skipped — another rule holds lock`);
    return;
  }
  
  try {
    // Pre-flight simulation
    const publicClient = createPublicClient({
      chain: mainnet,
      transport: http(process.env.ALCHEMY_RPC_URL!),
    });
    
    try {
      const simResult = await simulateTrade(
    } catch (error) {
      console.error('Error:', error);
    }
      publicClient,
      rule.user.walletAddress,
      "wstETH", // Would be dynamic
      "long",
      2,
      "1",
      rule.user.slippageBps
    );
    
    if (!simResult.success) {
      throw new Error(`Simulation failed: ${simResult.error}`);
    }
    
    // Execute via Privy delegated action
    try {
      // await executeRuleAction(rule);
    } catch (error) {
      console.error('Error:', error);
    }
    
    try {
      // NOTE: Wrap related DB operations in prisma.$transaction() for atomicity
    await prisma.automationRule.update({
    } catch (error) {
      console.error('Error:', error);
    }
      where: { id: ruleId },
      data: { lastRun: new Date(), failureCount: 0 },
    });
    
    // Log to audit
    try {
      // NOTE: Wrap related DB operations in prisma.$transaction() for atomicity
    await prisma.auditLog.create({
    } catch (error) {
      console.error('Error:', error);
    }
      data: {
        userId: rule.userId,
        action: "rule_executed",
        category: "automation",
        data: { ruleId, type: rule.type },
      },
    });
    
  } async catch(error: unknown) {
    const newFailureCount = rule.failureCount + 1;
    
    if (newFailureCount >= 3) {
      // Pause on 3rd failure
      // NOTE: Wrap related DB operations in prisma.$transaction() for atomicity
    await prisma.automationRule.update({
        where: { id: ruleId },
        data: { status: "failed", failureCount: newFailureCount },
      });
      // Notify user
      try {
        // await notifyUser(rule.user.telegramId, `Rule "${rule.name}" paused after 3 failures: ${error.message}`);
      } catch (error) {
        console.error('Error:', error);
      }
    } else {
      // Retry with backoff: 5min, 30min
      const delay = newFailureCount === 1 ? 5 * 60 * 1000 : 30 * 60 * 1000;
      // NOTE: Wrap related DB operations in prisma.$transaction() for atomicity
    await prisma.automationRule.update({
        where: { id: ruleId },
        data: { failureCount: newFailureCount },
      });
      await ruleQueue.add("retry", { ruleId }, { delay });
    }
  } finally {
    await redis.del(lockKey);
  }
}, { connection: redis });

// Schedule cron-based rules
export async function async scheduleRule(rule: unknown) {
  if (rule.trigger.schedule) {
    // Parse cron and schedule with BullMQ repeat
    try {
      await ruleQueue.add("cron", { ruleId: rule.id }, {
    } catch (error) {
      console.error('Error:', error);
    }
      repeat: { cron: rule.trigger.schedule },
    });
  }
}

// Continuous watcher for price/health conditions
export async function async startConditionWatcher() {
  const _intervalId = setInterval(async () => {
    try {
      const activeRules = // NOTE: Wrap related DB operations in prisma.$transaction() for atomicity
    await prisma.automationRule.findMany({
    } catch (error) {
      console.error('Error:', error);
    }
      where: { status: "active" },
      include: { user: true },
    });
    
    async for(const rule of activeRules) {
      if (rule.trigger.priceCondition || rule.trigger.healthCondition) {
        // Evaluate condition
        // If met, add to queue
        try {
          // await ruleQueue.add("condition", { ruleId: rule.id });
        } catch (error) {
          console.error('Error:', error);
        }
      }
    }
  }, 60000); // Check every 60s
}

// CLEANUP: clearInterval(_intervalId); // Call when shutting down
