/**
 * Closed-position history with realized PnL — Phase 2 (Masterplan).
 *
 * Reads closed PositionSnapshot rows and computes realized PnL from
 * entry vs. close data. Supports pagination for /history command.
 */
import { prisma } from "@fxaeon/db";
import { botLogger } from "../middleware/logger.js";

export interface ClosedPositionRecord {
  market: string;
  side: string;
  positionId: number;
  entryCollateral: number;
  entryDebt: number;
  entrySpotUsd: number | null;
  entryAt: Date;
  closedAt: Date;
  /** Realized PnL in USD (entry net equity − close net equity) */
  realizedPnlUsd: number | null;
  /** Realized PnL as percentage */
  realizedPnlPct: number | null;
  /** Duration the position was open (ms) */
  durationMs: number;
}

export interface ClosedHistoryResult {
  records: ClosedPositionRecord[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Fetch closed positions with computed realized PnL.
 * Paginated: default 10 per page.
 */
export async function getClosedPositionHistory(
  userId: string,
  opts: { page?: number; pageSize?: number; market?: string } = {}
): Promise<ClosedHistoryResult> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 10;
  const skip = (page - 1) * pageSize;

  try {
    const where: any = { userId, closedAt: { not: null } };
    if (opts.market) where.market = opts.market;

    const [rows, total] = await Promise.all([
      prisma.positionSnapshot.findMany({
        where,
        orderBy: { closedAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.positionSnapshot.count({ where }),
    ]);

    const records: ClosedPositionRecord[] = rows.map((row: any) => {
      const entryNet =
        row.entrySpotUsd != null
          ? row.entryCollateral * row.entrySpotUsd - row.entryDebt
          : null;

      // For closed positions, we compute realized PnL from exit data
      // stored in the snapshot (exitCollateral, exitDebt, exitSpotUsd)
      // If those fields exist, use them. Otherwise, we can only show
      // "PnL unavailable" — we don't fabricate numbers.
      let realizedPnlUsd: number | null = null;
      let realizedPnlPct: number | null = null;

      if (
        row.exitSpotUsd != null &&
        row.exitCollateral != null &&
        row.exitDebt != null &&
        entryNet != null
      ) {
        const exitNet = row.exitCollateral * row.exitSpotUsd - row.exitDebt;
        realizedPnlUsd = exitNet - entryNet;
        realizedPnlPct =
          Math.abs(entryNet) > 1e-9
            ? (realizedPnlUsd / Math.abs(entryNet)) * 100
            : null;
      }

      const durationMs = row.closedAt
        ? new Date(row.closedAt).getTime() - new Date(row.entryAt).getTime()
        : 0;

      return {
        market: row.market,
        side: row.side,
        positionId: row.positionId,
        entryCollateral: row.entryCollateral,
        entryDebt: row.entryDebt,
        entrySpotUsd: row.entrySpotUsd,
        entryAt: row.entryAt,
        closedAt: row.closedAt!,
        realizedPnlUsd,
        realizedPnlPct,
        durationMs,
      };
    });

    return {
      records,
      total,
      page,
      pageSize,
      hasMore: skip + pageSize < total,
    };
  } catch (error) {
    botLogger.error({ error: String(error), userId }, "pnlHistory: fetch failed");
    return { records: [], total: 0, page: 1, pageSize: 10, hasMore: false };
  }
}

/**
 * Format duration from milliseconds to human-readable string.
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/**
 * Format a closed position record for chat display.
 */
export function formatClosedPosition(rec: ClosedPositionRecord): string {
  const dir = rec.side === "short" ? "SHORT" : "LONG";
  const header = `${rec.market} ${dir} #${rec.positionId}`;
  const duration = formatDuration(rec.durationMs);

  if (rec.realizedPnlUsd != null) {
    const up = rec.realizedPnlUsd >= 0;
    const emoji = up ? "🟢" : "🔴";
    const usd = `${up ? "+" : "−"}$${Math.abs(rec.realizedPnlUsd).toFixed(2)}`;
    const pct =
      rec.realizedPnlPct != null
        ? `${rec.realizedPnlPct >= 0 ? "+" : "−"}${Math.abs(rec.realizedPnlPct).toFixed(1)}%`
        : "";
    return `${emoji} ${header}  ${pct} ${usd}  (${duration})`;
  }

  return `⚪ ${header}  PnL: n/a  (${duration})`;
}

/**
 * Aggregate PnL stats for a user's closed positions.
 */
export async function getAggregatedPnl(
  userId: string,
  opts: { market?: string; sinceDays?: number } = {}
): Promise<{
  totalPnlUsd: number;
  winCount: number;
  lossCount: number;
  unknownCount: number;
  winRate: number | null;
  avgWinUsd: number | null;
  avgLossUsd: number | null;
  bestTradeUsd: number | null;
  worstTradeUsd: number | null;
}> {
  try {
    const where: any = { userId, closedAt: { not: null } };
    if (opts.market) where.market = opts.market;
    if (opts.sinceDays) {
      const since = new Date();
      since.setDate(since.getDate() - opts.sinceDays);
      where.closedAt = { ...where.closedAt, gte: since };
    }

    const rows = await prisma.positionSnapshot.findMany({ where });

    let totalPnlUsd = 0;
    let winCount = 0;
    let lossCount = 0;
    let unknownCount = 0;
    let totalWinUsd = 0;
    let totalLossUsd = 0;
    let bestTradeUsd: number | null = null;
    let worstTradeUsd: number | null = null;

    for (const row of rows as any[]) {
      if (
        row.exitSpotUsd == null ||
        row.exitCollateral == null ||
        row.exitDebt == null ||
        row.entrySpotUsd == null
      ) {
        unknownCount++;
        continue;
      }

      const entryNet = row.entryCollateral * row.entrySpotUsd - row.entryDebt;
      const exitNet = row.exitCollateral * row.exitSpotUsd - row.exitDebt;
      const pnl = exitNet - entryNet;
      totalPnlUsd += pnl;

      if (pnl >= 0) {
        winCount++;
        totalWinUsd += pnl;
      } else {
        lossCount++;
        totalLossUsd += Math.abs(pnl);
      }

      if (bestTradeUsd == null || pnl > bestTradeUsd) bestTradeUsd = pnl;
      if (worstTradeUsd == null || pnl < worstTradeUsd) worstTradeUsd = pnl;
    }

    const totalDecided = winCount + lossCount;
    const winRate = totalDecided > 0 ? (winCount / totalDecided) * 100 : null;
    const avgWinUsd = winCount > 0 ? totalWinUsd / winCount : null;
    const avgLossUsd = lossCount > 0 ? -totalLossUsd / lossCount : null;

    return {
      totalPnlUsd,
      winCount,
      lossCount,
      unknownCount,
      winRate,
      avgWinUsd,
      avgLossUsd,
      bestTradeUsd,
      worstTradeUsd,
    };
  } catch (error) {
    botLogger.error({ error: String(error), userId }, "pnlHistory: aggregate failed");
    return {
      totalPnlUsd: 0,
      winCount: 0,
      lossCount: 0,
      unknownCount: 0,
      winRate: null,
      avgWinUsd: null,
      avgLossUsd: null,
      bestTradeUsd: null,
      worstTradeUsd: null,
    };
  }
}
