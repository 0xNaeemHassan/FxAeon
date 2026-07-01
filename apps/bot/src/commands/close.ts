/**
 * /close — shows the user's open positions and lets them close one.
 *
 * Phase 1: the static stub ("Please specify position ID to close") is replaced
 * by a real position picker that reads on-chain state via the f(x) SDK.
 *
 * If the user has one position, it goes directly to the close confirmation.
 * If multiple, it shows a picker with inline buttons. If none, it says so.
 */
import { Context, InlineKeyboard } from "grammy";
import type { I18nFlavor } from "@grammyjs/i18n";
import { prisma } from "@fxaeon/db";
import { MARKETS } from "@fxaeon/shared";
import { createFxSdk } from "../fx/index.js";
import { fetchOnChainPositions, type OnChainPosition } from "../core/portfolio.js";
import { botLogger } from "../middleware/logger.js";

function positionLabel(pos: OnChainPosition): string {
  return `${pos.market} ${pos.side.toUpperCase()} ${pos.leverage.toFixed(1)}x #${pos.positionId}`;
}

export default async function handler(ctx: Context & I18nFlavor): Promise<void> {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  try {
    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
      await ctx.reply(
        "🔐 Wallet Not Connected\n\nYou need to connect a wallet first.\n\nUse /start to begin the setup process."
      );
      return;
    }

    const { positions, failures } = await fetchOnChainPositions(
      createFxSdk(),
      user.walletAddress
    );

    if (positions.length === 0) {
      const failNote =
        failures.length > 0
          ? `\n\n⚠️ Couldn't read: ${failures.join(", ")} — retry shortly.`
          : "";
      await ctx.reply(
        `📊 No open positions to close.\n\nUse /trade or /longBTC /shortETH to open a position.${failNote}`
      );
      return;
    }

    if (positions.length === 1) {
      // Single position — show close confirmation directly
      const pos = positions[0];
      const mIdx = MARKETS.indexOf(pos.market);
      const sideKey = pos.side === "short" ? "s" : "l";
      const kb = new InlineKeyboard()
        .text("🔒 Close 100%", `pc_${mIdx}_${sideKey}_${pos.positionId}_full`)
        .text("❌ Cancel", "pc_cancel")
        .row();
      await ctx.reply(
        `🔒 Close Position\n\n` +
          `${positionLabel(pos)}\n` +
          `Collateral: ${Number(pos.collateral).toFixed(6)} ${pos.collateralToken}\n` +
          `Debt: ${Number(pos.debt).toFixed(2)} ${pos.debtToken}\n\n` +
          `Tap to close or cancel:`,
        { reply_markup: kb }
      );
      return;
    }

    // Multiple positions — show picker
    const kb = new InlineKeyboard();
    positions.slice(0, 8).forEach((pos) => {
      const mIdx = MARKETS.indexOf(pos.market);
      const sideKey = pos.side === "short" ? "s" : "l";
      kb.text(
        `🔒 ${positionLabel(pos)}`,
        `pc_${mIdx}_${sideKey}_${pos.positionId}`
      ).row();
    });

    await ctx.reply(
      `🔒 Close Position\n\n` +
        `You have ${positions.length} open positions. Pick one to close:`,
      { reply_markup: kb }
    );
  } catch (error) {
    botLogger.error({ err: error }, "closeCommand error");
    await ctx.reply(
      "❌ Couldn't load positions\n\nOn-chain read failed — your funds are unaffected. Please try again."
    );
  }
}
