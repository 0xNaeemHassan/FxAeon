import { Context } from "grammy";
import { prisma } from "@fxbot/db";
import { botLogger } from "../middleware/logger.js";
import { parseReferralPayload } from "../core/onboarding.js";
import { describeFunding, getFundingState } from "../core/funding.js";

export async function startCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  try {
    const referralCode = parseReferralPayload(ctx.message?.text);
    const user = await prisma.user.findUnique({ where: { telegramId } });

    if (!user) {
      // ── New user onboarding (W-16) ──────────────────────────────────────
      // The Create-Wallet button MUST be a reply-keyboard web_app button:
      // Telegram only delivers WebApp.sendData() for keyboard-launched apps.
      const miniAppUrl = process.env.MINI_APP_URL || "https://fxbot-mini-app.pages.dev";
      const loginUrl = referralCode
        ? `${miniAppUrl}/login?ref=${encodeURIComponent(referralCode)}`
        : `${miniAppUrl}/login`;

      await ctx.reply(
        `🚀 Welcome to fxBot\n\n` +
          `The most advanced interface for f(x) Protocol — leveraged positions, ` +
          `limit orders, and yield automation, all from Telegram.\n\n` +
          `🔐 Non-custodial — your wallet is policy-locked to f(x) contracts only\n` +
          `⚡ Simulation-gated — nothing broadcasts unless it simulates clean\n` +
          `🤖 Honest by design — no fake numbers, ever\n\n` +
          (referralCode ? `🎁 Referral code detected: ${referralCode}\n\n` : "") +
          `👇 Tap the button below to create your wallet.`,
        {
          reply_markup: {
            keyboard: [[{ text: "🔐 Create Wallet", web_app: { url: loginUrl } }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        }
      );

      botLogger.info(
        { telegramId, referredBy: referralCode },
        "onboarding started"
      );
      return;
    }

    // ── Returning user ─────────────────────────────────────────────────────
    const walletShort = `${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}`;
    const positionCount = await prisma.position.count({ where: { userId: user.id } });

    let welcomeMsg = `👋 Welcome back to fxBot!\n\nWallet: ${walletShort}\n`;

    if (positionCount > 0) {
      welcomeMsg += `\n📊 You have ${positionCount} active position${positionCount > 1 ? "s" : ""}.\n\n`;
      welcomeMsg += `Quick actions: /trade /portfolio /settings`;
    } else {
      // Funded-address empty states (W-16): balance-aware, fail-soft.
      const funding = await getFundingState(user.walletAddress as `0x${string}`);
      const fundingLine = describeFunding(funding);
      if (fundingLine) {
        welcomeMsg += fundingLine;
      } else {
        welcomeMsg += `\nNo active positions yet.\n\nGet started: /trade /portfolio /help`;
      }
    }

    await ctx.reply(welcomeMsg, { reply_markup: { remove_keyboard: true } });
  } catch (error) {
    botLogger.error({ err: error }, "startCommand error");
    await ctx.reply(
      `❌ Oops, something went wrong\n\nPlease try again in a moment. If the issue persists, contact support.`
    );
  }
}

export default startCommand;
