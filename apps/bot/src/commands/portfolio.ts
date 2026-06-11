/**
 * /portfolio — W-18: on-chain reads are the source of truth.
 *
 * Previously this rendered `prisma.position` rows that nothing ever wrote,
 * so users always saw an empty portfolio. It now reads PoolManager state via
 * the f(x) SDK, and the old risk meter was inverted (low debt ratio showed
 * as "CRITICAL") — fixed here: risk grows toward 1.0 = liquidation.
 */
import { Context, InlineKeyboard } from "grammy";
import { prisma } from "@fxbot/db";
import { HEALTH_LEVELS, MARKETS } from "@fxbot/shared";
import { createFxSdk } from "../fx/index.js";
import { fetchOnChainPositions, type OnChainPosition } from "../core/portfolio.js";
import { botLogger } from "../middleware/logger.js";

/** Risk meter: fills toward liquidation (1.0). HIGHER = riskier. */
export function getRiskBar(health: number): string {
  const clamped = Math.max(0, Math.min(1, health));
  const filled = Math.round(clamped * 10);
  const bar = "█".repeat(filled) + "░".repeat(10 - filled);
  if (health >= HEALTH_LEVELS.URGENT) return `🔴 ${bar} CRITICAL`;
  if (health >= HEALTH_LEVELS.WARNING) return `🟡 ${bar} WARNING`;
  return `🟢 ${bar} HEALTHY`;
}

function fmtAmount(n: number): string {
  if (n === 0) return "0";
  if (n < 0.0001) return n.toExponential(2);
  return n >= 100 ? n.toFixed(2) : Number(n.toPrecision(5)).toString();
}

function positionBlock(i: number, pos: OnChainPosition): string {
  return (
    `${i + 1}. ${pos.market} ${pos.side.toUpperCase()} ${pos.leverage.toFixed(2)}x  (#${pos.positionId})\n` +
    `   ${getRiskBar(pos.health)}\n` +
    `   Collateral: ${fmtAmount(pos.collateral)} ${pos.collateralToken}\n` +
    `   Debt: ${fmtAmount(pos.debt)} ${pos.debtToken}\n`
  );
}

function positionsKeyboard(positions: OnChainPosition[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  positions.slice(0, 6).forEach((pos, i) => {
    const mIdx = MARKETS.indexOf(pos.market);
    const sideKey = pos.side === "short" ? "s" : "l";
    kb.text(`🔻 Close #${i + 1}`, `pc_${mIdx}_${sideKey}_${pos.positionId}`)
      .text(`🎯 TP/SL #${i + 1}`, `pt_${mIdx}_${sideKey}`)
      .row();
  });
  return kb;
}

export async function portfolioCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) return;

  try {
    const user = await prisma.user.findUnique({ where: { telegramId } });

    if (!user) {
      await ctx.reply(
        `🔐 Wallet Not Connected\n\n` +
          `You need to connect a wallet first.\n\n` +
          `Use /start to begin the setup process.`
      );
      return;
    }

    const walletShort = `${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}`;
    const { positions, failures } = await fetchOnChainPositions(createFxSdk(), user.walletAddress);

    let msg = `📊 Portfolio (on-chain)\n\nWallet: ${walletShort}\n`;

    if (failures.length > 0) {
      msg += `\n⚠️ Couldn't read: ${failures.join(", ")} — those markets may have positions not shown here. Try again shortly.\n`;
    }

    if (positions.length === 0) {
      msg += `\nNo active positions${failures.length ? " in the markets we could read" : ""}.\n\n`;
      msg += `💡 Get started:\n`;
      msg += `• /trade — Open a leveraged position\n`;
      msg += `• /mint — Borrow fxUSD (no leverage)\n`;
      msg += `• /save — Deposit into fxSAVE for yield`;
      await ctx.reply(msg);
      return;
    }

    msg += `Positions: ${positions.length}\n\nActive Positions:\n\n`;
    positions.forEach((pos, i) => {
      msg += positionBlock(i, pos) + "\n";
    });

    const maxHealth = Math.max(...positions.map((p) => p.health));
    const riskLevel =
      maxHealth >= HEALTH_LEVELS.URGENT ? "🔴 HIGH" : maxHealth >= HEALTH_LEVELS.WARNING ? "🟡 MEDIUM" : "🟢 LOW";
    msg += `Risk: ${riskLevel} (riskiest position at ${(maxHealth * 100).toFixed(0)}% of liquidation threshold)\n\n`;
    msg += `Close or protect a position below, or /trade to open another.`;

    await ctx.reply(msg, { reply_markup: positionsKeyboard(positions) });
  } catch (error) {
    botLogger.error({ err: error }, "portfolioCommand error");
    await ctx.reply(
      `❌ Couldn't load portfolio\n\n` +
        `On-chain read failed — your funds are unaffected, this is a display issue. Please try again.`
    );
  }
}
