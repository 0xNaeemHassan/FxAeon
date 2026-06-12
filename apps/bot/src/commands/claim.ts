import { Context } from "grammy";
import { prisma } from "@fxbot/db";

export async function claimCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if(!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  await ctx.reply(
    `💎 *Claim Rewards*\\n\\n` +
    `Reward types: fxSAVE yield · Gauge rewards · Referral earnings\\n\\n` +
    `⚠️ On-chain execution for this action is not live yet — the confirm step was removed because it led to a dead screen. It will return when the f(x) SDK integration ships.\nLive today: /trade (leveraged positions), /portfolio, /deposit.`,
    { parse_mode: "Markdown" }
  );
}
