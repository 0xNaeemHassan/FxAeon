import { Context } from "grammy";
import { prisma } from "@fxbot/db";
import { MARKETS } from "@fxbot/shared";

export async function mintCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if(!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  const args = ctx.message?.text?.split(" ").slice(1) || [];
  if(args.length < 2) {
    await ctx.reply(
      `Usage: /mint <market> <collateral> <fxUSD amount>\n\n` +
      `Example: /mint wstETH 1ETH 1500\n\n` +
      `Borrow fxUSD against ETH/WBTC collateral (no leverage).`
    );
    return;
  }

  const [market, collateral, mintAmount] = args;
  const miniAppUrl = process.env.MINI_APP_URL || "https://fxbot-mini-app.pages.dev";
  await ctx.reply(
    `🏦 *fxMINT Preview*\n\n` +
    `Collateral: ${collateral} ${market}\n` +
    `Borrow: ${mintAmount} fxUSD\n\n` +
    `Tap to confirm:`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Confirm Mint", web_app: { url: `${miniAppUrl}/mint?market=${market}&collateral=${collateral}&mint=${mintAmount}` } }],
        ],
      },
    }
  );
}
