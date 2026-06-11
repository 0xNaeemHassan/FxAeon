import { Context } from "grammy";
import { prisma } from "@fxbot/db";
import { botLogger } from "../middleware/logger.js";

export async function startCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  try {
    // Check for referral code
    const startPayload = ctx.message?.text?.split(" ")[1];
    let referredBy: string | undefined;
    if (startPayload?.startsWith("ref_")) {
      referredBy = startPayload.replace("ref_", "");
    }

    // Check if user exists
    let user = await prisma.user.findUnique({ where: { telegramId } });

    if (!user) {
      // New user onboarding flow
      const miniAppUrl = process.env.MINI_APP_URL || "https://fxbot-mini-app.pages.dev";

      await ctx.reply(
        `🚀 Welcome to fxBot\n\n` +
        `The most advanced interface for f(x) Protocol — leveraged positions, limit orders, and yield automation, all from Telegram.\n\n` +
        `🔐 Non-custodial — your keys, your funds\n` +
        `⚡ Zero on-ramps — bring your own wallet\n` +
        `🤖 Trustless automation — set it and forget it\n\n` +
        `Need Help? Type /help for all commands.`
      );

      await ctx.reply(
        `👇 Step 1: Connect Wallet\n\n` +
        `We use Privy for secure, non-custodial key management. Your private keys never leave your device.`
      );

      botLogger.info({ telegramId, referredBy: referredBy || undefined }, "onboarding started");
    } else {
      // Returning user — personalized welcome
      const walletShort = `${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}`;
      const positionCount = await prisma.position.count({ where: { userId: user.id } });

      let welcomeMsg = `👋 Welcome back to fxBot!\n\n`;
      welcomeMsg += `Wallet: ${walletShort}\n\n`;

      if (positionCount > 0) {
        welcomeMsg += `📊 You have ${positionCount} active position${positionCount > 1 ? 's' : ''}.\n\n`;
        welcomeMsg += `Quick actions: /trade /portfolio /settings`;
      } else {
        welcomeMsg += `No active positions yet.\n\n`;
        welcomeMsg += `Get started: /trade /portfolio /help`;
      }

      await ctx.reply(welcomeMsg);
    }
  } catch (error) {
    console.error('[startCommand] Error:', error);
    await ctx.reply(
      `❌ Oops, something went wrong\n\nPlease try again in a moment. If the issue persists, contact support.`
    );
  }
}

export default startCommand;
