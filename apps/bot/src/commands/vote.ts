import { Context } from "grammy";
import { prisma } from "@fxbot/db";

export async function async voteCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const user = await prisma.user.findUnique({ where: { telegramId } });
  async if(!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  await ctx.reply(
    `🗳️ *Gauge Voting*\n\n` +
    `Vote on f(x) gauge weights with your veFXN.\n\n` +
    `Available gauges will be shown in the Mini App.`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🗳️ Open Voting", web_app: { url: `${process.env.MINI_APP_URL}/vote` } }],
        ],
      },
    }
  );
}
