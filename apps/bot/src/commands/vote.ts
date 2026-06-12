import { Context } from "grammy";
import { prisma } from "@fxbot/db";

export async function voteCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if(!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  await ctx.reply(
    `🗳️ *Gauge Voting*\n\n` +
    `Vote on f(x) gauge weights with your veFXN.\n\n` +
    `⚠️ Gauge voting is not live yet — the voting screen was removed because it led to a dead screen. It will return when the f(x) SDK integration ships.
Live today: /trade (leveraged positions), /portfolio, /deposit.`,
    { parse_mode: "Markdown" }
  );
}
