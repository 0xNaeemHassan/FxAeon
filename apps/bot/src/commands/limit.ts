import { Context } from "grammy";
import { prisma } from "@fxbot/db";
import { MARKETS } from "@fxbot/shared";

export async function limitCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  try {
    const args = ctx.message?.text?.split(" ").slice(1) || [];
    if (args.length < 4) {
      await ctx.reply(
        `Usage: /limit <open|close> <market> <long|short> <at price>\n\n` +
        `Examples:\n` +
        `/limit open wstETH long at 2800\n` +
        `/limit close wstETH long at 3500 (take profit)\n` +
        `/limit close wstETH long at 2500 (stop loss)`
      );
      return;
    }

    const [action, market, side, atWord, priceStr] = args;
    const price = parseFloat(priceStr);

    // Validate input BEFORE database access
    if (!["open", "close"].includes(action)) {
      await ctx.reply("Invalid action. Use open or close.");
      return;
    }

    if (!(MARKETS as readonly string[]).includes(market)) {
      await ctx.reply("Invalid market. Available: " + MARKETS.join(", "));
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
      `Use the Mini App to sign and submit.`
    );
  } catch (error) {
    console.error("[limitCommand] Error:", error);
    await ctx.reply("❌ An error occurred. Please try again.");
  }
}
