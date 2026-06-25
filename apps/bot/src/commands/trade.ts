import { Context } from "grammy";
import type { I18nFlavor } from "@grammyjs/i18n";
import { prisma } from "@fxaeon/db";
import { MARKETS, RISK_PARAMS } from "@fxaeon/shared";
import { buildPreview, ladderMarketKeyboard } from "../handlers/tradeActions.js";

export async function tradeCommand(ctx: Context & I18nFlavor) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  try {
    // Parse: /trade wstETH long 3x 1ETH
    const args = ctx.message?.text?.split(" ").slice(1) || [];

    if (args.length < 3) {
      // W-17: bare /trade opens the inline ladder (market → side → leverage
      // → amount). The usage text stays for power users.
      await ctx.reply(
        ctx.t("trade-usage", {
          minLev: RISK_PARAMS.MIN_LEVERAGE,
          maxLong: RISK_PARAMS.MAX_LEVERAGE_LONG,
          maxShort: RISK_PARAMS.MAX_LEVERAGE_SHORT,
        }),
        { reply_markup: ladderMarketKeyboard() }
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

    // W-17: signed preview with Confirm/Cancel inline buttons. Execution is
    // server-side, simulation-gated, and idempotent (core/tradeIntent.ts +
    // handlers/tradeActions.ts).
    const { text, keyboard } = buildPreview(
      { market: market as (typeof MARKETS)[number], side, leverage, amount },
      user,
      ctx.me?.username ?? "FxAeonBot"
    );
    await ctx.reply(text, { reply_markup: keyboard });
  } catch (error) {
    console.error('[tradeCommand] Error:', error);
    await ctx.reply(
      `❌ Trade Preview Failed\n\nPlease try again or use the Mini App.`
    );
  }
}
