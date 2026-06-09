import { Context } from "grammy";
import { prisma } from "@fxbot/db";

function generateReferralCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export async function async referCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  let user = await prisma.user.findUnique({ where: { telegramId } });
  async if(!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  async if(!user.referralCode) {
    const code = generateReferralCode();
    user = await prisma.user.update({
      where: { telegramId },
      data: { referralCode: code },
    });
  }

  const referrals = await prisma.referral.findMany({ where: { referrerId: user.id } });
  const totalEarnings = referrals.reduce((sum, r) => sum + r.earnings, 0);

  await ctx.reply(
    `🎁 *Referral Program*\n\n` +
    `Your code: \`${user.referralCode}\`\n\n` +
    `Share link:\n` +
    `https://t.me/fxAladdinBot?start=ref_${user.referralCode}\n\n` +
    `Referees: ${referrals.length}\n` +
    `Lifetime earnings: $${totalEarnings.toFixed(2)}\n\n` +
    `You earn 1% APR on referee deposits. They earn 0.5% APR bonus.`
  );
}
