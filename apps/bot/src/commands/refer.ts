/**
 * /refer — invite attribution only.
 *
 * FxAeon does not currently charge an application fee or run a referral
 * payout program. Report only facts we can verify: the user's code, share
 * link, and number of accounts linked through that code.
 */
import { Context, InlineKeyboard } from "grammy";
import { prisma } from "@fxaeon/db";
import { generateReferralCode } from "../core/onboarding.js";
import { botLogger } from "../middleware/logger.js";

export async function referCommand(ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  try {
    let user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
      await ctx.reply("Please connect your wallet first with /start");
      return;
    }

    if (!user.referralCode) {
      user = await prisma.user.update({
        where: { telegramId },
        data: { referralCode: generateReferralCode() },
      });
    }

    const referralCode = user.referralCode!;
    const referralCount = await prisma.referral.count({
      where: { referrerId: user.id },
    });
    const botUsername = ctx.me?.username ?? "FxAeonBot";
    const shareLink = `https://t.me/${botUsername}?start=ref_${referralCode}`;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(shareLink)}&text=${encodeURIComponent("Trade f(x) through FxAeon")}`;

    await ctx.reply(
      [
        "🎁 *Invite friends*",
        "",
        `📋 Your code: \`${referralCode}\``,
        `🔗 Share: ${shareLink}`,
        `👥 Linked accounts: ${referralCount}`,
        "",
        "ℹ️ This code attributes invites only. FxAeon currently charges no application fee and offers no referral reward or payout.",
      ].join("\n"),
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard().url("↗️ Share Invite", shareUrl),
      }
    );
  } catch (error) {
    botLogger.error({ err: error }, "referCommand error");
    await ctx.reply("❌ Couldn't load invite data. Please try again.");
  }
}
