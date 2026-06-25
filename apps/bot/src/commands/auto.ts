/**
 * /auto — REAL stop-loss / take-profit automation on open positions.
 *
 *   /auto sl wstETH long 2500   close wstETH longs if wstETH ≤ $2,500
 *   /auto tp wstETH long 3500   close wstETH longs if wstETH ≥ $3,500
 *   /auto sl WBTC short 70000   close WBTC shorts if WBTC ≥ $70,000
 *   /auto                       list rules (with delete buttons)
 *
 * Honesty contract: this command only advertises what actually executes.
 * Rules are evaluated every 60s in notifications/automation-poller.ts
 * against the shared CoinGecko spot snapshot, and a trigger runs the SAME
 * close path as the /portfolio Close button: fresh on-chain ownership read →
 * quote → simulate-before-broadcast → delegated Privy wallet. Creating a
 * rule therefore requires bot trading (a revocable session-signer grant) and
 * at least one matching open position.
 */
import { Context, InlineKeyboard, type Bot } from "grammy";
import { prisma } from "@fxaeon/db";
import { MARKETS, type Market } from "@fxaeon/shared";
import { getSpotPrices } from "../market/coingecko.js";
import { formatPrice } from "./price.js";
import { requireDelegatedWallet } from "../core/delegation.js";
import { createFxSdk } from "../fx/index.js";
import { listUserPositions, type Side } from "../core/portfolio.js";
import { botLogger } from "../middleware/logger.js";

/** Max active rules per user — keeps the poller's working set bounded. */
export const MAX_ACTIVE_RULES = 10;

export type RuleKind = "stop_loss" | "take_profit";

/** Stored in AutomationRule.triggerPrice (Json). */
export interface PriceTrigger {
  market: Market;
  side: Side;
  priceUsd: number;
  /** "below": fire when spot ≤ priceUsd. "above": fire when spot ≥ priceUsd. */
  direction: "below" | "above";
}

export interface ParsedRule {
  kind: RuleKind;
  market: Market;
  side: Side;
  priceUsd: number;
}

const USAGE =
  `🤖 Automation — stop-loss / take-profit\n\n` +
  `Usage:\n` +
  `/auto sl wstETH long 2500 — close wstETH longs if wstETH drops to $2,500\n` +
  `/auto tp wstETH long 3500 — close wstETH longs if wstETH reaches $3,500\n` +
  `/auto sl WBTC short 70000 — close WBTC shorts if WBTC rises to $70,000\n` +
  `/auto — list & manage your rules\n\n` +
  `Markets: ${MARKETS.join(", ")} · sides: long, short\n` +
  `A rule fires once: it closes the FULL matching position(s) through the ` +
  `same simulate-before-broadcast path as the Close button, then archives itself. ` +
  `Requires bot trading to be enabled (Settings → Wallet in the Mini App).`;

/** Which way a rule watches the market price. */
export function triggerDirection(kind: RuleKind, side: Side): "below" | "above" {
  // Long positions lose as price falls (SL below / TP above); shorts invert.
  if (side === "long") return kind === "stop_loss" ? "below" : "above";
  return kind === "stop_loss" ? "above" : "below";
}

/** Parse "/auto sl wstETH long 2500" args (without the command). */
export function parseRuleArgs(args: string[]): ParsedRule | string {
  const [rawKind, rawMarket, rawSide, rawPrice, ...extra] = args;
  if (!rawKind || extra.length > 0) return USAGE;

  const kindKey = rawKind.toLowerCase();
  const kind: RuleKind | null =
    kindKey === "sl" || kindKey === "stop" || kindKey === "stoploss"
      ? "stop_loss"
      : kindKey === "tp" || kindKey === "takeprofit"
        ? "take_profit"
        : null;
  if (!kind) {
    if (kindKey === "compound" || kindKey === "dca") {
      return (
        `"${rawKind}" automation isn't available yet — only stop-loss (sl) and ` +
        `take-profit (tp) rules execute today.\n\n${USAGE}`
      );
    }
    return USAGE;
  }

  const market = MARKETS.find((m) => m.toLowerCase() === (rawMarket ?? "").toLowerCase());
  if (!market) return `Unknown market "${rawMarket ?? ""}". Markets: ${MARKETS.join(", ")}`;

  const sideKey = (rawSide ?? "").toLowerCase();
  if (sideKey !== "long" && sideKey !== "short") {
    return `Side must be "long" or "short", e.g. /auto ${kindKey === "stop_loss" ? "sl" : "tp"} ${market} long 2500`;
  }

  const priceUsd = Number((rawPrice ?? "").replace(/[$,_]/g, ""));
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    return `Price must be a positive number, e.g. /auto sl ${market} ${sideKey} 2500`;
  }

  return { kind, market, side: sideKey as Side, priceUsd };
}

export function describeRule(rule: ParsedRule): string {
  const dir = triggerDirection(rule.kind, rule.side);
  const label = rule.kind === "stop_loss" ? "Stop-loss" : "Take-profit";
  return (
    `${label}: close ${rule.market} ${rule.side} when ${rule.market} ` +
    `${dir === "below" ? "≤" : "≥"} ${formatPrice(rule.priceUsd)}`
  );
}

export async function autoCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  try {
    const args = ctx.message?.text?.split(/\s+/).slice(1) ?? [];
    const user = await prisma.user.findUnique({ where: { telegramId } });

    // ── List & manage ──────────────────────────────────────────────────────
    if (args.length === 0 || args[0]?.toLowerCase() === "list") {
      const rules = user
        ? await prisma.automationRule.findMany({
            where: { userId: user.id, status: { in: ["active", "paused"] } },
            orderBy: { createdAt: "desc" },
          })
        : [];
      if (rules.length === 0) {
        await ctx.reply(USAGE);
        return;
      }
      const keyboard = new InlineKeyboard();
      const lines = rules.map((r, i) => {
        keyboard.text(`🗑 ${i + 1}`, `ardel_${r.id}`);
        const status = r.status === "active" ? "🟢" : "⏸️";
        return `${i + 1}. ${status} ${r.name}`;
      });
      keyboard.row();
      await ctx.reply(
        `🤖 Your automation rules\n\n${lines.join("\n")}\n\n` +
          `Rules fire once, then archive. Tap 🗑 to remove one.\n` +
          `Add more: /auto sl <market> <long|short> <price>`,
        { reply_markup: keyboard }
      );
      return;
    }

    // ── Create ─────────────────────────────────────────────────────────────
    const parsed = parseRuleArgs(args);
    if (typeof parsed === "string") {
      await ctx.reply(parsed);
      return;
    }
    if (!user) {
      await ctx.reply("Please connect your wallet first with /start");
      return;
    }

    // Rules execute real closes — without the (revocable) grant they could
    // never fire, so refuse creation instead of arming a dud.
    const gate = await requireDelegatedWallet(user);
    if (!gate.ok) {
      await ctx.reply(gate.message);
      return;
    }

    const activeCount = await prisma.automationRule.count({
      where: { userId: user.id, status: "active" },
    });
    if (activeCount >= MAX_ACTIVE_RULES) {
      await ctx.reply(
        `You already have ${MAX_ACTIVE_RULES} active rules (the maximum). Remove one with /auto first.`
      );
      return;
    }

    // The rule must have something to act on — fresh on-chain read.
    const sdk = createFxSdk();
    const positions = await listUserPositions(sdk, user.walletAddress, parsed.market, parsed.side);
    if (positions.length === 0) {
      await ctx.reply(
        `No open ${parsed.market} ${parsed.side} position found on-chain for your wallet — ` +
          `nothing for this rule to close. Open one first (/trade), then set the rule.`
      );
      return;
    }

    // Refuse rules that would fire on the very next tick — almost always a
    // mixed-up direction, and an instant close is never what the user meant.
    const direction = triggerDirection(parsed.kind, parsed.side);
    try {
      const snapshot = await getSpotPrices();
      const spot = snapshot.prices[parsed.market];
      if (typeof spot === "number" && !snapshot.stale) {
        const wouldFireNow = direction === "below" ? spot <= parsed.priceUsd : spot >= parsed.priceUsd;
        if (wouldFireNow) {
          await ctx.reply(
            `⚠️ ${parsed.market} is at ${formatPrice(spot)} right now — this ` +
              `${parsed.kind === "stop_loss" ? "stop-loss" : "take-profit"} at ${formatPrice(parsed.priceUsd)} ` +
              `would trigger immediately. Pick a level ${direction === "below" ? "below" : "above"} the ` +
              `current price, or close the position directly from /portfolio.`
          );
          return;
        }
      }
    } catch {
      /* price feed down — allow creation; the poller refuses stale fires */
    }

    const trigger: PriceTrigger = {
      market: parsed.market,
      side: parsed.side,
      priceUsd: parsed.priceUsd,
      direction,
    };
    const rule = await prisma.automationRule.create({
      data: {
        userId: user.id,
        name: describeRule(parsed),
        type: parsed.kind,
        triggerPrice: trigger as object,
        actionFn: "close_position",
        actionParams: { market: parsed.market, side: parsed.side } as object,
        maxValueUsd: 0, // full-close rules don't cap by USD value
        minIntervalSec: 0, // one-shot — never re-fires
        deadline: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });

    await ctx.reply(
      `✅ Rule armed: ${rule.name}\n\n` +
        `Checked every minute against live prices. When it triggers, the full ` +
        `position closes through the standard simulate-first path and you get a ` +
        `notification either way. It applies to ALL your open ${parsed.market} ` +
        `${parsed.side} positions (${positions.length} right now) and fires once.\n\n` +
        `Manage rules: /auto`
    );
  } catch (error) {
    botLogger.error({ error: String(error) }, "[autoCommand] failed");
    await ctx.reply("❌ An error occurred. Please try again.");
  }
}

/** Register the rule-delete callback. Call once from main.ts. */
 
export function registerAutoActions(bot: Bot<any>): void {
  bot.callbackQuery(/^ardel_[0-9a-f-]{36}$/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => undefined);
    const telegramId = ctx.from?.id.toString();
    const id = ctx.callbackQuery.data.slice("ardel_".length);
    if (!telegramId) return;
    try {
      const user = await prisma.user.findUnique({ where: { telegramId } });
      if (!user) return;
      // Ownership-scoped delete: the id alone is never trusted.
      const res = await prisma.automationRule.updateMany({
        where: { id, userId: user.id, status: { in: ["active", "paused"] } },
        data: { status: "cancelled" },
      });
      await ctx
        .editMessageText(
          res.count > 0
            ? `🗑 Rule removed. /auto to see what's left or arm a new one.`
            : `That rule is already gone. /auto for the current list.`
        )
        .catch(() => undefined);
    } catch (error) {
      botLogger.error({ error: String(error) }, "[auto] delete failed");
    }
  });
}
