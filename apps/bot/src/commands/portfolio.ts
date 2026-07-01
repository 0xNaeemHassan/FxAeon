/**
 * /portfolio — Phase 4: Single-screen redesign with sections + aliases.
 *
 * /portfolio, /positions, /pnl, /history, /balance, /wallet all open the
 * same screen and scroll to the relevant section. The command renders:
 *   1. Summary bar (total value, wallet, positions, fxSAVE)
 *   2. Open positions with action buttons
 *   3. Closed positions (last 7 days)
 *   4. Performance (30-day stats)
 *
 * On-chain positions are the source of truth (via f(x) SDK). Closed-position
 * history uses PositionSnapshot rows (closedAt != null). PnL uses entry
 * snapshots from `trackPositions`.
 */
import { Context, InlineKeyboard } from "grammy";
import type { I18nFlavor } from "@grammyjs/i18n";
import { prisma } from "@fxaeon/db";
import { HEALTH_LEVELS, MARKETS } from "@fxaeon/shared";
import { createFxSdk } from "../fx/index.js";
import { fetchOnChainPositions, type OnChainPosition } from "../core/portfolio.js";
import { trackPositions, computePnl, snapshotKey, type SnapshotMap } from "../core/pnl.js";
import { getSpotPrices } from "../market/coingecko.js";
import { botLogger } from "../middleware/logger.js";

// ── Utilities ────────────────────────────────────────────────────────────

/** Risk meter: fills toward liquidation (1.0). HIGHER = riskier. */
export function getRiskBar(health: number): string {
  const clamped = Math.max(0, Math.min(1, health));
  const filled = Math.round(clamped * 10);
  const bar = "▓".repeat(filled) + "░".repeat(10 - filled);
  if (health >= HEALTH_LEVELS.URGENT) return `🔴 ${bar} ${(health * 100).toFixed(0)}%`;
  if (health >= HEALTH_LEVELS.WARNING) return `🟡 ${bar} ${(health * 100).toFixed(0)}%`;
  return `🟢 ${bar} ${(health * 100).toFixed(0)}%`;
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

function pctStr(pct: number | null): string {
  if (pct === null) return "";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/**
 * USD estimates from live CoinGecko spot prices.
 */
export function positionUsd(
  pos: OnChainPosition,
  prices: Record<string, number | null>
): { collateralUsd: number; debtUsd: number; netUsd: number } | null {
  const colPrice = prices[pos.collateralToken];
  if (typeof colPrice !== "number") return null;
  const debtPrice = pos.debtToken === "fxUSD" ? (prices["FXUSD"] ?? 1) : prices[pos.debtToken];
  if (typeof debtPrice !== "number") return null;
  const collateralUsd = pos.collateral * colPrice;
  const debtUsd = pos.debt * debtPrice;
  return { collateralUsd, debtUsd, netUsd: collateralUsd - debtUsd };
}

// ── Section: Summary ─────────────────────────────────────────────────────

function buildSummary(
  walletShort: string,
  positions: OnChainPosition[],
  prices: Record<string, number | null> | null
): string[] {
  const lines = [`📊  Portfolio — ${walletShort}`, ``];

  if (!prices) {
    lines.push(`(Prices unavailable — amounts shown without USD estimates)`, ``);
    return lines;
  }

  let totalPositionUsd = 0;
  let hasAll = true;
  for (const pos of positions) {
    const usd = positionUsd(pos, prices);
    if (usd) totalPositionUsd += usd.netUsd;
    else hasAll = false;
  }

  // Wallet value placeholder — would require balance reads for all tokens.
  // For now show position value + note.
  const posStr = hasAll ? fmtUsd(totalPositionUsd) : `~${fmtUsd(totalPositionUsd)}+`;

  lines.push(
    `Open positions:   ${posStr}    (${positions.length} position${positions.length !== 1 ? "s" : ""})`,
    ``
  );

  return lines;
}

// ── Section: Open Positions ──────────────────────────────────────────────

function pnlLine(
  pos: OnChainPosition,
  snapshots: SnapshotMap,
  prices: Record<string, number | null> | null
): string {
  const snap = snapshots.get(snapshotKey(pos));
  const pnl = computePnl(pos, snap, prices);
  if (!pnl) return "";
  const up = pnl.pnlUsd >= 0;
  const sign = up ? "+" : "-";
  const pct = pnl.pnlPct === null ? "" : ` (${sign}${Math.abs(pnl.pnlPct).toFixed(1)}%)`;
  return `   ${up ? "🟢" : "🔴"} PnL: ${sign}${fmtUsd(Math.abs(pnl.pnlUsd))}${pct}`;
}

function buildOpenPositions(
  positions: OnChainPosition[],
  prices: Record<string, number | null> | null,
  snapshots: SnapshotMap
): string[] {
  if (positions.length === 0) {
    return [`────── OPEN POSITIONS ──────`, `(no open positions)`, ``];
  }

  const lines = [`────── OPEN POSITIONS ──────`];
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const usd = prices ? positionUsd(pos, prices) : null;
    const side = pos.side === "long" ? "🔵" : "🔴";
    const pnl = pnlLine(pos, snapshots, prices);

    lines.push(
      `${side} ${pos.market} ${pos.side.toUpperCase()}  #${pos.positionId}   ${pos.leverage.toFixed(1)}×   Health ${getRiskBar(pos.health)}`
    );
    if (usd) {
      lines.push(`   ${fmtUsd(usd.collateralUsd - usd.debtUsd)}${pnl ? `  ${pnl.trim()}` : ""}`);
    }
    lines.push(
      `   [ Close ]  [ Inc ]  [ Dec ]  [ Adj Lev ]  [ TP/SL ]`
    );
    lines.push(``);
  }
  return lines;
}

// ── Section: Closed Positions (last 7d) ──────────────────────────────────

async function buildClosedPositions(userId: string): Promise<string[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  try {
    const closed = await prisma.positionSnapshot.findMany({
      where: {
        userId,
        closedAt: { gte: sevenDaysAgo },
      },
      orderBy: { closedAt: "desc" },
      take: 10,
    });

    if (closed.length === 0) {
      return [`────── CLOSED (last 7d) ──────`, `(no closed positions)`, ``];
    }

    const lines = [`────── CLOSED (last 7d) ──────`];
    for (const snap of closed) {
      const ago = snap.closedAt
        ? `${Math.round((Date.now() - snap.closedAt.getTime()) / (24 * 60 * 60 * 1000))}d ago`
        : "";
      const pnlStr = snap.realizedPnlUsd !== null
        ? `${snap.realizedPnlUsd >= 0 ? "+" : ""}${fmtUsd(snap.realizedPnlUsd)}`
        : "";
      lines.push(
        `${snap.market} ${snap.side.toUpperCase()}  #${snap.positionId}   ${ago}    ${pnlStr}`
      );
    }
    lines.push(``);
    return lines;
  } catch {
    return [`────── CLOSED (last 7d) ──────`, `(couldn't load history)`, ``];
  }
}

// ── Section: Performance (30d) ───────────────────────────────────────────

async function buildPerformance(userId: string): Promise<string[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  try {
    const [closedAgg, feeAgg] = await Promise.all([
      prisma.positionSnapshot.aggregate({
        where: {
          userId,
          closedAt: { gte: thirtyDaysAgo },
          realizedPnlUsd: { not: null },
        },
        _sum: { realizedPnlUsd: true, closingFeesUsd: true },
        _count: true,
      }),
      prisma.feeLedger.aggregate({
        where: { userId, createdAt: { gte: thirtyDaysAgo } },
        _sum: { usdAmount: true },
      }),
    ]);

    // Win rate
    let winRate = "";
    if (closedAgg._count > 0) {
      const wins = await prisma.positionSnapshot.count({
        where: {
          userId,
          closedAt: { gte: thirtyDaysAgo },
          realizedPnlUsd: { gt: 0 },
        },
      });
      winRate = `Win rate:         ${wins}/${closedAgg._count} (${((wins / closedAgg._count) * 100).toFixed(1)}%)`;
    }

    const realizedPnl = closedAgg._sum.realizedPnlUsd ?? 0;
    const closingFees = closedAgg._sum.closingFeesUsd ?? 0;
    const fxaeonFees = feeAgg._sum.usdAmount ?? 0;
    const totalFees = closingFees + fxaeonFees;

    const lines = [
      `────── PERFORMANCE (30d) ──────`,
      `Realized PnL:     ${realizedPnl >= 0 ? "+" : ""}${fmtUsd(realizedPnl)}`,
      `Total fees paid:  ${fmtUsd(totalFees)}   (f(x) ${fmtUsd(closingFees)}  •  FxAeon ${fmtUsd(fxaeonFees)})`,
    ];
    if (winRate) lines.push(winRate);
    lines.push(``);
    return lines;
  } catch {
    return [`────── PERFORMANCE (30d) ──────`, `(couldn't compute stats)`, ``];
  }
}

// ── Action keyboard ──────────────────────────────────────────────────────

function positionsKeyboard(positions: OnChainPosition[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  positions.slice(0, 4).forEach((pos, i) => {
    const mIdx = MARKETS.indexOf(pos.market);
    const sideKey = pos.side === "short" ? "s" : "l";
    kb.text(`🔻 Close #${i + 1}`, `pc_${mIdx}_${sideKey}_${pos.positionId}`)
      .text(`🎯 TP/SL #${i + 1}`, `pt_${mIdx}_${sideKey}`)
      .row();
  });
  kb.text("🔄 Refresh", "pf_refresh")
    .text("📈 Trade", "tl_start")
    .row()
    .text("🪙 Earn", "sv_overview")
    .text("📱 Open in Mini App", "pf_miniapp");
  return kb;
}

// ── Main command ─────────────────────────────────────────────────────────

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

    const walletShort = `${user.walletAddress.slice(0, 6)}…${user.walletAddress.slice(-4)}`;
    const { positions, failures } = await fetchOnChainPositions(createFxSdk(), user.walletAddress);

    const parts: string[] = [];

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

    if (failures.length > 0) {
      parts.push(
        `⚠️ Couldn't read: ${failures.join(", ")} — those markets may have positions not shown here.\n`
      );
    }

    // 1. Summary
    parts.push(...buildSummary(walletShort, positions, prices));

    // 2. Open Positions
    parts.push(...buildOpenPositions(positions, prices, snapshots));

    // 3. Closed Positions
    parts.push(...(await buildClosedPositions(user.id)));

    // 4. Performance
    parts.push(...(await buildPerformance(user.id)));

    const msg = parts.join("\n");
    await ctx.reply(msg, { reply_markup: positionsKeyboard(positions) });
  } catch (error) {
    botLogger.error({ err: error }, "portfolioCommand error");
    await ctx.reply(
      `❌ Couldn't load portfolio\n\n` +
        `On-chain read failed — your funds are unaffected, this is a display issue. Please try again.`
    );
  }
}
