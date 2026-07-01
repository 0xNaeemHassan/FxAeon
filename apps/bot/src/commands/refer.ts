/**
 * /refer — Referral dashboard with lifetime, accruing, payout history.
 * Phase 5 (Masterplan) — replaces the Phase 1 stub.
 *
 * Shows:
 * - Referral code + share link
 * - Tier info (30% at <$25k/mo, 50% at ≥$25k/mo)
 * - Lifetime stats: total volume, total payouts, # cycles
 * - Accruing (current cycle): volume, fees, estimated payout
 * - Recent payout history (last 6 cycles)
 */
import { Context, InlineKeyboard } from "grammy";
import { prisma } from "@fxaeon/db";
import { generateReferralCode } from "../core/onboarding.js";
import { getReferrerPayoutHistory, getReferrerTier } from "../notifications/referral-payout.js";
import { botLogger } from "../middleware/logger.js";

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

export async function referCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  try {
    let user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
      await ctx.reply("Please connect your wallet first with /start");
      return;
    }

    if (!user.referralCode) {
      const code = generateReferralCode();
      user = await prisma.user.update({
        where: { telegramId },
        data: { referralCode: code },
      });
    }

    const botUsername = ctx.me?.username ?? "FxAeonBot";
    const shareLink = `https://t.me/${botUsername}?start=ref_${user.referralCode}`;

    // Get referral stats
    const referrals = await prisma.referral.findMany({ where: { referrerId: user.id } });
    const payoutData = await getReferrerPayoutHistory(user.referralCode!);

    // Current tier
    const { tier, sharePct } = getReferrerTier(payoutData.accruing.volumeUsd);

    // Build the dashboard
    const lines: string[] = [
      `🎁 *Referral Program*\n`,
      `📋 Your code: \`${user.referralCode}\``,
      `🔗 Share: ${shareLink}\n`,
      `👥 Referees: ${referrals.length}`,
      `🏆 Current tier: ${tier === 2 ? "Pro (50%)" : "Starter (30%)"}`,
      tier === 1
        ? `   ${fmtUsd(TIER_1_THRESHOLD - payoutData.accruing.volumeUsd)} more volume to reach Pro tier`
        : `   ✅ Pro tier unlocked`,
      ``,
      `📊 *Lifetime*`,
      `   Volume: ${fmtUsd(payoutData.lifetime.totalVolumeUsd)}`,
      `   Payouts: ${fmtUsd(payoutData.lifetime.totalPayoutUsd)} (${payoutData.lifetime.cycleCount} cycles)`,
      ``,
      `📈 *Accruing (this month)*`,
      `   Volume: ${fmtUsd(payoutData.accruing.volumeUsd)}`,
      `   Fees generated: ${fmtUsd(payoutData.accruing.feeUsd)}`,
      `   Est. payout: ${fmtUsd(payoutData.accruing.estimatedPayoutUsd)} (${sharePct}% share)`,
    ];

    if (payoutData.history.length > 0) {
      lines.push(``, `💰 *Recent Payouts*`);
      for (const h of payoutData.history.slice(0, 6)) {
        const paidDate = h.paidAt ? h.paidAt.toISOString().slice(0, 10) : "pending";
        lines.push(`   ${h.cycle}: ${fmtUsd(h.payoutUsd)} (vol: ${fmtUsd(h.volumeUsd)}) — ${paidDate}`);
      }
    }

    lines.push(
      ``,
      `ℹ️ *How it works:*`,
      `• Earn ${sharePct}% of FxAeon fees from your referees' trades`,
      `• Tier 1 (Starter): 30% share, <$25k/mo volume`,
      `• Tier 2 (Pro): 50% share, ≥$25k/mo volume`,
      `• Payouts processed monthly in FXN`,
      `• Self-referrals are excluded`
    );

    const kb = new InlineKeyboard().text("📋 Copy Link", `ref_copy`);

    await ctx.reply(lines.join("\n"), {
      parse_mode: "Markdown",
      reply_markup: kb,
    });
  } catch (error) {
    botLogger.error({ err: error }, "referCommand error");
    await ctx.reply("❌ Couldn't load referral data. Please try again.");
  }
}

const TIER_1_THRESHOLD = 25_000;
