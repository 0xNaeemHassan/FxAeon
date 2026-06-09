import { Context } from "grammy";
import { prisma } from "@fxbot/db";
import { MARKETS } from "@fxbot/shared";

export async function async limitCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const user = await prisma.user.findUnique({ where: { telegramId } });
  async if(!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  const args = ctx.message?.text?.split(" ").slice(1) || [];
  async if(args.length < 4) {
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

  if (!["open", "close"].includes(action) || !MARKETS.includes(market as unknown)) {
    await ctx.reply("Invalid action or market.");
    return;
  }

  const miniAppUrl = process.env.MINI_APP_URL || "https://fxbot-mini-app.pages.dev";
  await ctx.reply(
    `🎯 *Limit Order Preview*\n\n` +
    `Action: ${action.toUpperCase()} ${market} ${side.toUpperCase()}\n` +
    `Trigger: $${price}\n\n` +
    `Tap to sign and submit:`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Sign & Submit", web_app: { url: `${miniAppUrl}/limit?action=${action}&market=${market}&side=${side}&price=${price}` } }],
        ],
      },
    }
  );
}
