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
  await ctx.reply(
    `🏦 *fxMINT Preview*\n\n` +
    `Collateral: ${collateral} ${market}\n` +
    `Borrow: ${mintAmount} fxUSD\n\n` +
    `

⚠️ On-chain execution for this action is not live yet — the confirm step was removed because it led to a dead screen. It will return when the f(x) SDK integration ships.
Live today: /trade (leveraged positions), /portfolio, /deposit.`,
    { parse_mode: "Markdown" }
  );
}
