import { Context } from "grammy";
import { prisma } from "@fxbot/db";

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
      
      // Step 1: Welcome with visual branding
      await ctx.reply(
        `🚀 *Welcome to FxAeon*

` +
        `The most advanced interface for f(x) Protocol — leveraged positions, limit orders, and yield automation, all from Telegram.

` +
        `🔐 *Non-custodial* — your keys, your funds
` +
        `⚡ *Zero on-ramps* — bring your own wallet
` +
        `🤖 *Trustless automation* — set it and forget it

` +
        `Let's get you set up in ~30 seconds.`,
        { parse_mode: "Markdown" }
      );

      // Step 2: Connect wallet CTA with prominent button
      await ctx.reply(
        `👇 *Step 1: Connect Your Wallet*

` +
        `We use Privy for secure, non-custodial key management. Your private keys never leave your device.`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { 
                  text: "🔐 Connect Wallet", 
                  web_app: { url: `${miniAppUrl}/login?ref=${referredBy || ""}` } 
                }
              ],
              [
                { text: "📖 How It Works", callback_data: "help_onboarding" },
                { text: "🛡️ Security Info", callback_data: "help_security" }
              ],
            ],
          },
        }
      );

      // Track onboarding start (for analytics)
      console.log(`[Onboarding] User ${telegramId} started onboarding flow${referredBy ? ` via ref ${referredBy}` : ''}`);
    } else {
      // Returning user — personalized welcome
      const walletShort = `${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}`;
      const positionCount = await prisma.position.count({ where: { userId: user.id } });
      
      let welcomeMsg = `👋 *Welcome back!*

`;
      welcomeMsg += `Wallet: \`${walletShort}\`

`;
      
      if (positionCount > 0) {
        welcomeMsg += `📊 You have ${positionCount} active position${positionCount > 1 ? 's' : ''}.

`;
        welcomeMsg += `Quick actions:`;
      } else {
        welcomeMsg += `No active positions yet.

`;
        welcomeMsg += `Get started:`;
      }

      await ctx.reply(welcomeMsg, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "📊 Portfolio", callback_data: "nav_portfolio" },
              { text: "⚡ Trade", callback_data: "nav_trade" }
            ],
            [
              { text: "💰 Deposit", callback_data: "nav_deposit" },
              { text: "⚙️ Settings", callback_data: "nav_settings" }
            ],
            [
              { text: "📚 All Commands", callback_data: "nav_help" }
            ]
          ],
        },
      });
    }
  } catch (error) {
    console.error('[startCommand] Error:', error);
    await ctx.reply(
      `❌ *Oops, something went wrong*

` +
      `Please try again in a moment. If the issue persists, contact support.`,
      { parse_mode: "Markdown" }
    );
  }
}
