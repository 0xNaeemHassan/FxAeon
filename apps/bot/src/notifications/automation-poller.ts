/**
 * Automation poller — executes /auto stop-loss / take-profit rules.
 *
 * Every 60s: if any rule is active, read the shared CoinGecko spot snapshot
 * (the same in-process cache /price, /portfolio and the alert poller use —
 * no extra upstream cost) and fire crossed rules.
 *
 * Execution honesty:
 * - A fired rule runs the EXACT close path of the /portfolio Close button:
 *   fresh on-chain ownership read → quote → simulate-before-broadcast →
 *   delegated Privy wallet. No shortcut, no special-cased risk.
 * - Stale snapshots never fire rules: trading on old prices is worse than
 *   waiting one cycle.
 * - One-shot with atomic claim: a rule flips active→executing via a guarded
 *   updateMany before anything is sent, so overlapping cycles can't
 *   double-fire. Idempotency keys include the attempt number, so a retried
 *   close after a failed attempt gets a fresh key while a duplicate within
 *   one attempt is deduped by executeRoute.
 * - Failures keep the rule active (failureCount++) up to MAX_FAILURES, then
 *   pause it with a notification — silent zombie rules are not a thing.
 * - A revoked bot-trading grant pauses the rule and tells the user why.
 */
import { prisma } from "@fxbot/db";
import type { Market } from "@fxbot/shared";
import { getSpotPrices } from "../market/coingecko.js";
import { formatPrice } from "../commands/price.js";
import type { PriceTrigger } from "../commands/auto.js";
import { listUserPositions, type OnChainPosition, type Side } from "../core/portfolio.js";
import { markSnapshotClosed } from "../core/pnl.js";
import { requireDelegatedWallet } from "../core/delegation.js";
import { executeRoute } from "../core/txExecutor.js";
import { describeExecutionError } from "../core/errorTaxonomy.js";
import { createFxSdk, createPublicClientForUser, mevModeForUser, quoteClosePosition } from "../fx/index.js";
import { notify } from "./notify.js";
import { heartbeat, incr } from "../core/metrics.js";
import { workerLogger } from "../middleware/logger.js";

const POLL_INTERVAL_MS = 60_000;
/** After this many failed execution attempts the rule pauses (no zombies). */
export const MAX_FAILURES = 3;

export interface RuleRecord {
  id: string;
  userId: string;
  name: string;
  type: string;
  triggerPrice: unknown;
  failureCount: number;
  deadline: Date;
}

/** Pure trigger predicate — exported for tests. */
export function ruleShouldFire(rule: RuleRecord, prices: Record<string, number | null>): number | null {
  const trigger = rule.triggerPrice as unknown as PriceTrigger | null;
  if (!trigger || typeof trigger.priceUsd !== "number" || !trigger.market) return null;
  const spot = prices[trigger.market];
  if (typeof spot !== "number") return null;
  if (trigger.direction === "below") return spot <= trigger.priceUsd ? spot : null;
  if (trigger.direction === "above") return spot >= trigger.priceUsd ? spot : null;
  return null;
}

export function formatTriggerMessage(rule: RuleRecord, spot: number): string {
  const trigger = rule.triggerPrice as unknown as PriceTrigger;
  return (
    `🤖 Rule triggered: ${rule.name}\n` +
    `${trigger.market} is at ${formatPrice(spot)} — closing your ${trigger.market} ` +
    `${trigger.side} position(s) now. You'll get the result here.`
  );
}

interface CloseOutcome {
  position: OnChainPosition;
  ok: boolean;
  detail: string;
}

/** Close every matching position through the standard execution path. */
async function closeMatchingPositions(
  user: { id: string; walletAddress: string; slippageBps: number; mevProtection: string },
  walletId: string,
  market: Market,
  side: Side,
  ruleId: string,
  attempt: number
): Promise<CloseOutcome[] | "no_positions"> {
  const sdk = createFxSdk();
  const positions = await listUserPositions(sdk, user.walletAddress, market, side);
  if (positions.length === 0) return "no_positions";

  const outcomes: CloseOutcome[] = [];
  for (const pos of positions) {
    try {
      const quote = await quoteClosePosition({
        sdk,
        userAddress: user.walletAddress,
        market,
        side,
        positionId: pos.positionId,
        amountWei: pos.rawCollateral,
        slippagePercent: user.slippageBps / 100,
        isClosePosition: true,
      });
      const route = quote.routes[0];
      if (!route) {
        outcomes.push({ position: pos, ok: false, detail: "no close route available" });
        continue;
      }
      const result = await executeRoute({
        userId: user.id,
        walletId,
        walletAddress: user.walletAddress as `0x${string}`,
        idempotencyKey: `auto:${ruleId}:${pos.positionId}:${attempt}`,
        txs: route.txs,
        type: side === "long" ? "close_long" : "close_short",
        client: createPublicClientForUser(user.mevProtection === "flashbots" ? "flashbots" : "off"),
        mev: mevModeForUser(user.mevProtection),
      });
      outcomes.push(
        result.ok
          ? {
              position: pos,
              ok: true,
              detail: result.hashes[result.hashes.length - 1]
                ? `https://etherscan.io/tx/${result.hashes[result.hashes.length - 1]}`
                : "",
            }
          : { position: pos, ok: false, detail: describeExecutionError(result.error) }
      );
    } catch (error) {
      outcomes.push({ position: pos, ok: false, detail: String(error) });
    }
  }
  return outcomes;
}

export const automationPoller = {
  async check(): Promise<void> {
    heartbeat("automation-poller");
    try {
      const rules = await prisma.automationRule.findMany({
        where: { status: "active", type: { in: ["stop_loss", "take_profit"] } },
        include: { user: true },
      });
      if (rules.length === 0) return;

      const snapshot = await getSpotPrices();
      if (snapshot.stale) {
        incr("automation.skipped_stale");
        return; // never trade on old prices
      }

      for (const rule of rules) {
        // Expired rules archive quietly — they were armed for a reason that
        // is 90+ days old; firing them now would be a surprise, not a service.
        if (rule.deadline.getTime() < Date.now()) {
          await prisma.automationRule.update({
            where: { id: rule.id },
            data: { status: "expired" },
          });
          continue;
        }

        const spot = ruleShouldFire(rule, snapshot.prices);
        if (spot === null) continue;

        // Atomic claim: only one cycle may execute this rule.
        const claimed = await prisma.automationRule.updateMany({
          where: { id: rule.id, status: "active" },
          data: { status: "executing", lastRun: new Date() },
        });
        if (claimed.count === 0) continue;

        const user = rule.user;
        const trigger = rule.triggerPrice as unknown as PriceTrigger;

        const gate = await requireDelegatedWallet(user);
        if (!gate.ok) {
          await prisma.automationRule.update({
            where: { id: rule.id },
            data: { status: "paused", failureCount: { increment: 1 } },
          });
          await notify({
            userId: user.id,
            telegramId: user.telegramId,
            kind: "rules",
            message:
              `⏸️ Rule paused: ${rule.name}\n` +
              `It triggered (${trigger.market} at ${formatPrice(spot)}) but bot trading is ` +
              `not enabled, so nothing was sent. Re-enable it in Settings → Wallet (Mini App), ` +
              `then re-arm with /auto.`,
          });
          continue;
        }

        await notify({
          userId: user.id,
          telegramId: user.telegramId,
          kind: "rules",
          message: formatTriggerMessage(rule, spot),
        });

        const outcomes = await closeMatchingPositions(
          user,
          gate.walletId,
          trigger.market,
          trigger.side,
          rule.id,
          rule.failureCount
        );

        if (outcomes === "no_positions") {
          await prisma.automationRule.update({
            where: { id: rule.id },
            data: { status: "completed" },
          });
          await notify({
            userId: user.id,
            telegramId: user.telegramId,
            kind: "rules",
            message:
              `ℹ️ ${rule.name} — no matching ${trigger.market} ${trigger.side} position is open ` +
              `on-chain anymore (already closed?). Rule archived; nothing was sent.`,
          });
          continue;
        }

        const failed = outcomes.filter((o) => !o.ok);
        const succeeded = outcomes.filter((o) => o.ok);
        for (const o of succeeded) {
          incr("automation.close_ok");
          await markSnapshotClosed(user.id, o.position.market, o.position.side, o.position.positionId);
          await notify({
            userId: user.id,
            telegramId: user.telegramId,
            kind: "rules",
            message:
              `✅ ${rule.type === "stop_loss" ? "Stop-loss" : "Take-profit"} executed: closed ` +
              `${o.position.market} ${o.position.side} #${o.position.positionId}.` +
              (o.detail ? `\nTx: ${o.detail}` : "") +
              `\n\n📊 /portfolio for the updated view.`,
          });
        }

        if (failed.length === 0) {
          await prisma.automationRule.update({
            where: { id: rule.id },
            data: { status: "triggered" },
          });
          continue;
        }

        // Partial or total failure: report honestly, retry next cycle with a
        // fresh attempt number — up to MAX_FAILURES, then pause.
        incr("automation.close_failed");
        const failures = rule.failureCount + 1;
        const exhausted = failures >= MAX_FAILURES;
        await prisma.automationRule.update({
          where: { id: rule.id },
          data: { status: exhausted ? "paused" : "active", failureCount: failures },
        });
        await notify({
          userId: user.id,
          telegramId: user.telegramId,
          kind: "rules",
          message:
            `❌ ${rule.name} — ${failed.length} of ${outcomes.length} close(s) did not complete:\n` +
            failed.map((o) => `• #${o.position.positionId}: ${o.detail}`).join("\n") +
            (exhausted
              ? `\n\n⏸️ Rule paused after ${failures} failed attempts. Close manually from /portfolio ` +
                `or re-arm with /auto.`
              : `\n\nIt stays armed and retries on the next price check.`),
        });
      }
    } catch (error) {
      workerLogger.error({ error: String(error) }, "[automation-poller] cycle failed");
    }
  },

  start(): NodeJS.Timeout {
    const timer = setInterval(() => void this.check(), POLL_INTERVAL_MS);
    workerLogger.info("Automation poller started (60s interval)");
    return timer;
  },
};
