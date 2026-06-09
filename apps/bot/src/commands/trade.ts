import { Context } from "grammy";
import { prisma } from "@fxbot/db";
import { MARKETS, RISK_PARAMS } from "@fxbot/shared";

export async function tradeCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  try {
    const user = await prisma.user.findUnique({ where: { telegramId } });
    
    if (!user) {
      await ctx.reply(
        `🔐 *Wallet Required*

` +
        `Please connect your wallet first with /start`,
        { 
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔐 Connect Wallet", callback_data: "nav_start" }]
            ]
          }
        }
      );
      return;
    }

    // Parse: /trade wstETH long 3x 1ETH
    const args = ctx.message?.text?.split(" ").slice(1) || [];
    
    if (args.length < 3) {
      const miniAppUrl = process.env.MINI_APP_URL || "https://fxbot-mini-app.pages.dev";
      
      await ctx.reply(
        `⚡ *Open a Leveraged Position*

` +
        `*Usage:*
` +
        `\`/trade <market> <long|short> <leverage> <amount>\`

` +
        `*Example:*
` +
        `\`/trade wstETH long 3x 1ETH\`

` +
        `*Available Markets:*
` +
        `${MARKETS.map(m => `• ${m}`).join("
")}

` +
        `*Leverage Limits:*
` +
        `• Long: ${RISK_PARAMS.MIN_LEVERAGE}x – ${RISK_PARAMS.MAX_LEVERAGE_LONG}x
` +
        `• Short: ${RISK_PARAMS.MIN_LEVERAGE}x – ${RISK_PARAMS.MAX_LEVERAGE_SHORT}x

` +
        `Or use the Mini App for a guided experience:`,
        { 
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { 
                  text: "📱 Open in Mini App", 
                  web_app: { url: `${miniAppUrl}/trade` } 
                }
              ],
              [
                { text: "📖 Trading Guide", callback_data: "help_trading" },
                { text: "⚠️ Risk Info", callback_data: "help_risk" }
              ]
            ]
          }
        }
      );
      return;
    }

    const [market, side, leverageStr, amountStr] = args;
    const leverage = parseFloat(leverageStr.replace("x", ""));
    const amount = parseFloat(amountStr.replace("ETH", "").replace("WBTC", ""));

    // Validation with helpful error messages
    if (!MARKETS.includes(market as any)) {
      await ctx.reply(
        `❌ *Invalid Market*

` +
        `\`${market}\` is not available.

` +
        `*Available markets:*
${MARKETS.join(", ")}

` +
        `Try: \`/trade wstETH long 3x 1ETH\``,
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (side !== "long" && side !== "short") {
      await ctx.reply(
        `❌ *Invalid Side*

` +
        `Use \`long\` or \`short\`.

` +
        `Example: \`/trade wstETH long 3x 1ETH\``,
        { parse_mode: "Markdown" }
      );
      return;
    }

    const maxLev = side === "long" 
      ? RISK_PARAMS.MAX_LEVERAGE_LONG 
      : RISK_PARAMS.MAX_LEVERAGE_SHORT;
    
    if (isNaN(leverage) || leverage < RISK_PARAMS.MIN_LEVERAGE || leverage > maxLev) {
      await ctx.reply(
        `❌ *Invalid Leverage*

` +
        `Leverage must be between ${RISK_PARAMS.MIN_LEVERAGE}x and ${maxLev}x for ${side} positions.

` +
        `Example: \`/trade wstETH long 3x 1ETH\``,
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (isNaN(amount) || amount <= 0) {
      await ctx.reply(
        `❌ *Invalid Amount*

` +
        `Please specify a positive amount.

` +
        `Example: \`/trade wstETH long 3x 1ETH\``,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Show trade preview with confirmation
    const miniAppUrl = process.env.MINI_APP_URL || "https://fxbot-mini-app.pages.dev";
    const slippage = (user.slippageBps / 100).toFixed(2);
    
    await ctx.reply(
      `⚡ *Trade Preview*

` +
      `Market: *${market} ${side.toUpperCase()}*
` +
      `Leverage: *${leverage}x*
` +
      `Collateral: *${amount} ETH*
` +
      `Slippage: *${slippage}%*
` +
      `MEV Protection: *${user.mevProtection ? "ON ✅" : "OFF ⚠️"}*

` +
      `⚠️ *Risk Warning:*
` +
      `Leveraged trading carries risk of liquidation. Only trade what you can afford to lose.

` +
      `Tap to confirm and sign:`,
      { 
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { 
                text: "✅ Confirm & Sign", 
                web_app: { url: `${miniAppUrl}/trade?market=${market}&side=${side}&leverage=${leverage}&amount=${amount}` } 
              }
            ],
            [
              { text: "⚙️ Change Settings", callback_data: "nav_settings" },
              { text: "❌ Cancel", callback_data: "cancel_trade" }
            ]
          ]
        }
      }
    );
  } catch (error) {
    console.error('[tradeCommand] Error:', error);
    await ctx.reply(
      `❌ *Trade Preview Failed*

` +
      `Please try again or use the Mini App for a guided experience.`,
      { 
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📱 Open Mini App", callback_data: "nav_trade" }]
          ]
        }
      }
    );
  }
}
