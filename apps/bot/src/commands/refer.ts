import { Context } from "grammy";
import { prisma } from "@fxaeon/db";
import { generateReferralCode } from "../core/onboarding.js";

export async function referCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  let user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await ctx.reply("Please connect your wallet first with /start");
    return;
  }

  if (!user.referralCode) {
    // Pre-W-16 rows may lack a code; backfill with the CSPRNG generator.
    const code = generateReferralCode();
    user = await prisma.user.update({
      where: { telegramId },
      data: { referralCode: code },
    });
  }

  const referrals = await prisma.referral.findMany({ where: { referrerId: user.id } });
  const totalEarnings = referrals.reduce((sum, r) => sum + r.earnings, 0);

  // Use the live bot username — the old hardcoded link pointed at a
  // different bot (fxAladdinBot), silently breaking every share link.
  const botUsername = ctx.me?.username ?? "FxAeonBot";

  await ctx.reply(
    `🎁 *Referral Program*\n\n` +
      `Your code: \`${user.referralCode}\`\n\n` +
      `Share link:\n` +
      `https://t.me/${botUsername}?start=ref_${user.referralCode}\n\n` +
      `Referees: ${referrals.length}\n` +
      `Lifetime earnings: $${totalEarnings.toFixed(2)}\n\n` +
      `You earn 1% APR on referee deposits. They earn 0.5% APR bonus.`
  );
}
