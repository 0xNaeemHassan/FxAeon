import { Context } from "grammy";
import { prisma } from "@fxbot/db";

export async function async claimCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  const user = await prisma.user.findUnique({ where: { telegramId } });
  async if(!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  const miniAppUrl = process.env.MINI_APP_URL || "https://fxbot-mini-app.pages.dev";
  await ctx.reply(
    `💎 *Claim Rewards*\n\n` +
    `Claimable rewards:\n` +
    `• fxSAVE yield\n` +
    `• Gauge rewards\n` +
    `• Referral earnings\n\n` +
    `Tap to claim all:`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "💎 Claim All", web_app: { url: `${miniAppUrl}/claim` } }],
        ],
      },
    }
  );
}
