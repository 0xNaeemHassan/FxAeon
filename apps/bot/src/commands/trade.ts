import { Context } from "grammy";
import type { I18nFlavor } from "@grammyjs/i18n";
import { prisma } from "@fxaeon/db";
import { MARKETS, RISK_PARAMS } from "@fxaeon/shared";
import { buildPreview, ladderMarketKeyboard } from "../handlers/tradeActions.js";
import { botLogger } from "../middleware/logger.js";
import { canonicalActionAmount } from "../core/actionIntent.js";

export async function tradeCommand(ctx: Context & I18nFlavor) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  try {
    // Parse: /trade wstETH long 3x 0.25 (amount is native market units)
    const args = ctx.message?.text?.trim().split(/\s+/).slice(1) || [];

    if (args.length === 0) {
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

    if (args.length !== 4) {
      await ctx.reply("❌ Invalid trade syntax.\n\nUsage: /trade <market> <long|short> <leverage> <native amount>\nExample: /trade wstETH long 3x 0.25");
      return;
    }

    const [marketInput, sideInput, leverageStr, amountStr] = args;
    const market = MARKETS.find((item) => item.toLowerCase() === marketInput.toLowerCase());
    const side = sideInput.toLowerCase();
    const leverageMatch = /^(\d+(?:\.\d+)?|\.\d+)x?$/i.exec(leverageStr);
    const leverage = leverageMatch ? Number(leverageMatch[1]) : NaN;
    const amountPattern = market
      ? new RegExp(`^(\\d+(?:\\.\\d+)?|\\.\\d+)(?:${market.toLowerCase()})?$`, "i")
      : null;
    const amountMatch = amountPattern?.exec(amountStr);
    const amount = amountMatch && market
      ? canonicalActionAmount(amountMatch[1], market === "WBTC" ? 8 : 18)
      : null;

    // Validation — BEFORE any database calls
    if (!market) {
      await ctx.reply(
        `❌ Invalid market: ${market}\n\n` +
        `Available markets: ${MARKETS.join(", ")}\n\n` +
        `Try: /trade wstETH long 3x 0.25`
      );
      return;
    }

    if (side !== "long" && side !== "short") {
      await ctx.reply(
        `⚡ Open a Leveraged Position\n\n` +
        `Usage:\n` +
        `/trade <market> <long|short> <leverage> <amount>\n\n` +
        `Use long or short.\n\n` +
        `Example: /trade wstETH long 3x 0.25`
      );
      return;
    }

    const maxLev = side === "long"
      ? RISK_PARAMS.MAX_LEVERAGE_LONG
      : RISK_PARAMS.MAX_LEVERAGE_SHORT;

    if (isNaN(leverage) || !Number.isInteger(leverage * 10) || leverage < RISK_PARAMS.MIN_LEVERAGE || leverage > maxLev) {
      await ctx.reply(
        `❌ Invalid Leverage\n\n` +
        `Leverage must be between ${RISK_PARAMS.MIN_LEVERAGE}x and ${maxLev}x for ${side} positions.\n\n` +
        `Example: /trade wstETH long 3x 0.25`
      );
      return;
    }

    if (!amount) {
      await ctx.reply(
        `❌ Invalid Amount\n\nUse a positive ${market} amount (not ETH, USD, or another token).\n\nExample: /trade wstETH long 3x 0.25`
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
      { market, side, leverage, amount },
      user,
      ctx.me?.username ?? "FxAeonBot"
    );
    await ctx.reply(text, { reply_markup: keyboard });
  } catch (error) {
    botLogger.error({ err: error, telegramId }, "trade command failed");
    await ctx.reply(
      `❌ Trade Preview Failed\n\nPlease try again or use the Mini App.`
    );
  }
}
