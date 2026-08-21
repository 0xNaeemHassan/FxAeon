import { Context } from "grammy";
import { prisma } from "@fxaeon/db";
import { MARKETS } from "@fxaeon/shared";
import { botLogger } from "../middleware/logger.js";

export async function limitCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  try {
    const args = ctx.message?.text?.split(" ").slice(1) || [];
    if (args.length !== 5) {
      await ctx.reply(
        `Usage: /limit <open|close> <market> <long|short> <at price>\n\n` +
        `Examples:\n` +
        `/limit open wstETH long at 2800\n` +
        `/limit close wstETH long at 3500 (take profit)\n` +
        `/limit close wstETH long at 2500 (stop loss)`
      );
      return;
    }

    const [action, market, side, _atWord, priceStr] = args;
    const price = /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(priceStr) ? Number(priceStr) : NaN;

    // Validate input BEFORE database access
    if (!["open", "close"].includes(action)) {
      await ctx.reply("Invalid action. Use open or close.");
      return;
    }

    if (!(MARKETS as readonly string[]).includes(market)) {
      await ctx.reply("Invalid market. Available: " + MARKETS.join(", "));
      return;
    }

    if (side !== "long" && side !== "short") {
      await ctx.reply("Invalid side. Use long or short.");
      return;
    }

    if (_atWord.toLowerCase() !== "at") {
      await ctx.reply("Invalid syntax. Put “at” before the trigger price.");
      return;
    }

    if (!Number.isFinite(price) || price <= 0) {
      await ctx.reply("Invalid trigger price. Enter a positive number.");
      return;
    }

    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
      await ctx.reply("Please connect your wallet first with /start");
      return;
    }

    await ctx.reply(
      `🎯 Limit Order Preview\n\n` +
      `Action: ${action.toUpperCase()} ${market} ${side.toUpperCase()}\n` +
      `Trigger: $${price}\n\n` +
      `⚠️ Preview only — no order was created. Limit-order signing is not available in the current chat or Mini App UI.`
    );
  } catch (error) {
    botLogger.error({ err: error, telegramId }, "limit command failed");
    await ctx.reply("❌ An error occurred. Please try again.");
  }
}
