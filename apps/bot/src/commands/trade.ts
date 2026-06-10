import { Context } from "grammy";
import { prisma } from "@fxbot/db";
import { MARKETS, RISK_PARAMS } from "@fxbot/shared";

export async function tradeCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  try {
    // Parse: /trade wstETH long 3x 1ETH
    const args = ctx.message?.text?.split(" ").slice(1) || [];

    if (args.length < 3) {
      await ctx.reply(
        `⚡ Open a Leveraged Position\n\n` +
        `Usage:\n` +
        `/trade <market> <long|short> <leverage> <amount>\n\n` +
        `Example:\n` +
        `/trade wstETH long 3x 1ETH\n\n` +
        `Available Markets:\n` +
        `${MARKETS.map(m => `• ${m}`).join("\n")}\n\n` +
        `Leverage Limits:\n` +
        `• Long: ${RISK_PARAMS.MIN_LEVERAGE}x – ${RISK_PARAMS.MAX_LEVERAGE_LONG}x\n` +
        `• Short: ${RISK_PARAMS.MIN_LEVERAGE}x – ${RISK_PARAMS.MAX_LEVERAGE_SHORT}x`
      );
      return;
    }

    const [market, side, leverageStr, amountStr] = args;
    const leverage = parseFloat(leverageStr.replace("x", ""));
    const amount = amountStr ? parseFloat(amountStr.replace("ETH", "").replace("WBTC", "")) : NaN;

    // Validation — BEFORE any database calls
    if (!(MARKETS as readonly string[]).includes(market)) {
      await ctx.reply(
        `❌ Invalid market: ${market}\n\n` +
        `Available markets: ${MARKETS.join(", ")}\n\n` +
        `Try: /trade wstETH long 3x 1ETH`
      );
      return;
    }

    if (side !== "long" && side !== "short") {
      await ctx.reply(
        `⚡ Open a Leveraged Position\n\n` +
        `Usage:\n` +
        `/trade <market> <long|short> <leverage> <amount>\n\n` +
        `Use long or short.\n\n` +
        `Example: /trade wstETH long 3x 1ETH`
      );
      return;
    }

    const maxLev = side === "long"
      ? RISK_PARAMS.MAX_LEVERAGE_LONG
      : RISK_PARAMS.MAX_LEVERAGE_SHORT;

    if (isNaN(leverage) || leverage < RISK_PARAMS.MIN_LEVERAGE || leverage > maxLev) {
      await ctx.reply(
        `❌ Invalid Leverage\n\n` +
        `Leverage must be between ${RISK_PARAMS.MIN_LEVERAGE}x and ${maxLev}x for ${side} positions.\n\n` +
        `Example: /trade wstETH long 3x 1ETH`
      );
      return;
    }

    if (isNaN(amount) || amount <= 0) {
      await ctx.reply(
        `❌ Invalid Amount\n\nPlease specify a positive amount.\n\nExample: /trade wstETH long 3x 1ETH`
      );
      return;
    }

    // Database access — after all validation passes
    const user = await prisma.user.findUnique({ where: { telegramId } });

    if (!user) {
      await ctx.reply(
        `🔐 Wallet Required\n\nPlease connect your wallet first with /start`
      );
      return;
    }

    // Show trade preview
    const slippage = (user.slippageBps / 100).toFixed(2);

    await ctx.reply(
      `⚡ Trade Preview\n\n` +
      `Market: ${market} ${side.toUpperCase()}\n` +
      `Leverage: ${leverage}x\n` +
      `Collateral: ${amount} ETH\n` +
      `Slippage: ${slippage}%\n` +
      `MEV Protection: ${user.mevProtection ? "ON ✅" : "OFF ⚠️"}\n\n` +
      `⚠️ Risk Warning:\n` +
      `Leveraged trading carries risk of liquidation. Only trade what you can afford to lose.`
    );
  } catch (error) {
    console.error('[tradeCommand] Error:', error);
    await ctx.reply(
      `❌ Trade Preview Failed\n\nPlease try again or use the Mini App.`
    );
  }
}
