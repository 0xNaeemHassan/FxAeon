/**
 * /portfolio — W-18: on-chain reads are the source of truth.
 *
 * Previously this rendered `prisma.position` rows that nothing ever wrote,
 * so users always saw an empty portfolio. It now reads PoolManager state via
 * the f(x) SDK, and the old risk meter was inverted (low debt ratio showed
 * as "CRITICAL") — fixed here: risk grows toward 1.0 = liquidation.
 */
import { Context, InlineKeyboard } from "grammy";
import type { I18nFlavor } from "@grammyjs/i18n";
import { prisma } from "@fxbot/db";
import { HEALTH_LEVELS, MARKETS } from "@fxbot/shared";
import { createFxSdk } from "../fx/index.js";
import { fetchOnChainPositions, type OnChainPosition } from "../core/portfolio.js";
import { trackPositions, computePnl, snapshotKey, type SnapshotMap } from "../core/pnl.js";
import { getSpotPrices } from "../market/coingecko.js";
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

function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  const s = abs >= 1000 ? Math.round(abs).toLocaleString("en-US") : abs.toFixed(2);
  return `${n < 0 ? "-" : ""}$${s}`;
}

/**
 * USD estimates from live CoinGecko spot prices (same cached snapshot
 * /price uses). Returns null when a needed price is unavailable — we omit
 * the estimate rather than guess.
 */
export function positionUsd(
  pos: OnChainPosition,
  prices: Record<string, number | null>
): { collateralUsd: number; debtUsd: number; netUsd: number } | null {
  const colPrice = prices[pos.collateralToken];
  if (typeof colPrice !== "number") return null;
  // Debt is fxUSD; use its live price when available, $1.00 otherwise.
  const debtPrice = pos.debtToken === "fxUSD" ? (prices["FXUSD"] ?? 1) : prices[pos.debtToken];
  if (typeof debtPrice !== "number") return null;
  const collateralUsd = pos.collateral * colPrice;
  const debtUsd = pos.debt * debtPrice;
  return { collateralUsd, debtUsd, netUsd: collateralUsd - debtUsd };
}

function pnlLine(
  pos: OnChainPosition,
  snapshots: SnapshotMap,
  prices: Record<string, number | null> | null
): string {
  const pnl = computePnl(pos, snapshots.get(snapshotKey(pos)), prices);
  if (!pnl) return "";
  const sign = pnl.pnlUsd >= 0 ? "+" : "-";
  const pct = pnl.pnlPct === null ? "" : ` (${sign}${Math.abs(pnl.pnlPct).toFixed(1)}%)`;
  const date = pnl.since.toISOString().slice(0, 10);
  return `   PnL since ${date}: ${sign}${fmtUsd(Math.abs(pnl.pnlUsd)).slice(pnl.pnlUsd < 0 ? 1 : 0)}${pct}\n`;
}

function positionBlock(
  i: number,
  pos: OnChainPosition,
  prices: Record<string, number | null> | null,
  snapshots: SnapshotMap
): string {
  const usd = prices ? positionUsd(pos, prices) : null;
  return (
    `${i + 1}. ${pos.market} ${pos.side.toUpperCase()} ${pos.leverage.toFixed(2)}x  (#${pos.positionId})\n` +
    `   ${getRiskBar(pos.health)}\n` +
    `   Collateral: ${fmtAmount(pos.collateral)} ${pos.collateralToken}` +
    (usd ? ` (~${fmtUsd(usd.collateralUsd)})` : "") +
    `\n` +
    `   Debt: ${fmtAmount(pos.debt)} ${pos.debtToken}` +
    (usd ? ` (~${fmtUsd(usd.debtUsd)})` : "") +
    `\n` +
    (usd ? `   Net equity: ~${fmtUsd(usd.netUsd)}\n` : "") +
    pnlLine(pos, snapshots, prices)
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

export async function portfolioCommand(ctx: Context & I18nFlavor) {
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
      msg += "\n" + ctx.t("portfolio-empty", { partial: failures.length ? "yes" : "no" });
      await ctx.reply(msg);
      return;
    }

    // Live USD estimates — fail-soft: a price outage only hides the ~$ lines.
    let prices: Record<string, number | null> | null = null;
    try {
      const spot = await getSpotPrices();
      if (!spot.stale) prices = spot.prices;
    } catch {
      /* prices unavailable — render amounts only */
    }

    // Entry snapshots: first-seen tracking for honest PnL estimates.
    const snapshots = await trackPositions(user.id, positions, prices, failures);

    msg += `Positions: ${positions.length}\n\nActive Positions:\n\n`;
    positions.forEach((pos, i) => {
      msg += positionBlock(i, pos, prices, snapshots) + "\n";
    });

    if (prices) {
      const totals = positions
        .map((p) => positionUsd(p, prices))
        .filter((u): u is NonNullable<typeof u> => u !== null);
      if (totals.length === positions.length) {
        const net = totals.reduce((s, u) => s + u.netUsd, 0);
        msg += `Total net equity: ~${fmtUsd(net)} (live CoinGecko estimate)\n\n`;
      }
    }

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
