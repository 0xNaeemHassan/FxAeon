/**
 * PnL tracking (entry snapshots) — honest by construction.
 *
 * f(x) positions live on-chain only; the chain doesn't remember entry
 * prices. So we snapshot a position's state the FIRST time we see it:
 * immediately after a bot-executed open (true entry) or on the first
 * /portfolio render for positions opened elsewhere ("since tracking
 * began"). PnL is then current net equity minus entry net equity, both
 * valued with live CoinGecko spot — and simply omitted when either side
 * can't be priced. No fabricated entries, ever.
 */
import { prisma } from "@fxaeon/db";
import type { OnChainPosition } from "./portfolio.js";
import { workerLogger } from "../middleware/logger.js";

export interface SnapshotRecord {
  market: string;
  side: string;
  positionId: number;
  entryCollateral: number;
  entryDebt: number;
  entrySpotUsd: number | null;
  entryAt: Date;
}

export type SnapshotMap = Map<string, SnapshotRecord>;

export function snapshotKey(p: { market: string; side: string; positionId: number }): string {
  return `${p.market}:${p.side}:${p.positionId}`;
}

/**
 * Reconcile snapshots with the current on-chain view: create missing ones,
 * close out ones whose position vanished (only for market/side combos that
 * were READ SUCCESSFULLY — an RPC failure must not "close" a snapshot).
 * Returns the open snapshots keyed by market:side:positionId. Fail-soft:
 * a DB hiccup returns an empty map and /portfolio renders without PnL.
 */
export async function trackPositions(
  userId: string,
  positions: OnChainPosition[],
  prices: Record<string, number | null> | null,
  failedReads: string[] = []
): Promise<SnapshotMap> {
  try {
    const existing = await prisma.positionSnapshot.findMany({
      where: { userId, closedAt: null },
    });
    const byKey = new Map(existing.map((s) => [snapshotKey(s), s]));
    const seen = new Set(positions.map((p) => snapshotKey(p)));

    // New positions → entry snapshot (entry spot only if the feed is live).
    for (const pos of positions) {
      if (byKey.has(snapshotKey(pos))) continue;
      const spot = prices ? prices[pos.collateralToken] : null;
      const created = await prisma.positionSnapshot.upsert({
        where: {
          userId_market_side_positionId: {
            userId,
            market: pos.market,
            side: pos.side,
            positionId: pos.positionId,
          },
        },
        // Position id re-used on-chain after a tracked close → new entry.
        update: { 
          entryCollateral: pos.collateral,
          entryDebt: pos.debt,
          entrySpotUsd: typeof spot === "number" ? spot : null,
          entryAt: new Date(),
          closedAt: null,
        },
        create: {
          userId,
          market: pos.market,
          side: pos.side,
          positionId: pos.positionId,
          entryCollateral: pos.collateral,
          entryDebt: pos.debt,
          entrySpotUsd: typeof spot === "number" ? spot : null,
        },
      });
      byKey.set(snapshotKey(pos), created);
    }

    // Vanished positions → closed (but never on the back of a failed read).
    const failed = new Set(failedReads);
    for (const snap of existing) {
      if (seen.has(snapshotKey(snap))) continue;
      if (failed.has(`${snap.market} ${snap.side}`)) continue;
      await prisma.positionSnapshot.update({
        where: { id: snap.id },
        data: { closedAt: new Date() },
      });
      byKey.delete(snapshotKey(snap));
    }

    return new Map(
      [...byKey.entries()].map(([k, s]) => [
        k,
        {
          market: s.market,
          side: s.side,
          positionId: s.positionId,
          entryCollateral: s.entryCollateral,
          entryDebt: s.entryDebt,
          entrySpotUsd: s.entrySpotUsd,
          entryAt: s.entryAt,
        },
      ])
    );
  } catch (error) {
    workerLogger.warn({ error: String(error), userId }, "pnl: snapshot reconcile failed");
    return new Map();
  }
}

export interface PnlEstimate {
  pnlUsd: number;
  /** Percent vs entry net equity; null when entry equity ≈ 0. */
  pnlPct: number | null;
  since: Date;
}

/**
 * Unrealized PnL vs the entry snapshot. Pure; returns null whenever any
 * needed price is missing — omission over estimation.
 */
export function computePnl(
  pos: OnChainPosition,
  snap: SnapshotRecord | undefined,
  prices: Record<string, number | null> | null
): PnlEstimate | null {
  if (!snap || typeof snap.entrySpotUsd !== "number" || !prices) return null;
  if (!(snap.entryAt instanceof Date) || typeof snap.entryCollateral !== "number" || typeof snap.entryDebt !== "number") {
    return null; // malformed snapshot — omit rather than guess
  }
  // Same valuation convention as /portfolio's positionUsd (kept local to
  // avoid a command↔core import cycle): live collateral spot, fxUSD at its
  // live price when available and $1 otherwise.
  const colPrice = prices[pos.collateralToken];
  if (typeof colPrice !== "number") return null;
  const debtPrice = pos.debtToken === "fxUSD" ? (prices["FXUSD"] ?? 1) : prices[pos.debtToken];
  if (typeof debtPrice !== "number") return null;
  const current = { netUsd: pos.collateral * colPrice - pos.debt * debtPrice };
  // Entry debt is fxUSD — valued at $1, same convention positionUsd falls
  // back to when FXUSD itself is unpriced.
  const entryNet = snap.entryCollateral * snap.entrySpotUsd - snap.entryDebt;
  const pnlUsd = current.netUsd - entryNet;
  const pnlPct = Math.abs(entryNet) > 1e-9 ? (pnlUsd / Math.abs(entryNet)) * 100 : null;
  return { pnlUsd, pnlPct, since: snap.entryAt };
}

/** Mark one snapshot closed after a confirmed bot-executed close. */
export async function markSnapshotClosed(
  userId: string,
  market: string,
  side: string,
  positionId: number
): Promise<void> {
  try {
    await prisma.positionSnapshot.updateMany({
      where: { userId, market, side, positionId, closedAt: null },
      data: { closedAt: new Date() },
    });
  } catch (error) {
    workerLogger.warn({ error: String(error), userId }, "pnl: mark closed failed");
  }
}


/**
 * One-line PnL card for chat / mini-app — fixes the "positions show as
 * unreadable NFTs" problem by rendering human PnL, e.g.
 *   🟢 wstETH LONG #3 · 2.00x
 *   +12.0% PnL | +$420.00 | Entry: $3,400
 */
export function formatPnlCard(
  pos: Pick<OnChainPosition, "market" | "side" | "positionId" | "leverage">,
  estimate: PnlEstimate | null,
  snap?: SnapshotRecord
): string {
  const dir = pos.side.toLowerCase() === "short" ? "SHORT" : "LONG";
  const header = `${pos.market} ${dir} #${pos.positionId} · ${pos.leverage.toFixed(2)}x`;
  if (!estimate) return `⚪ ${header}\nPnL: n/a (entry snapshot pending)`;
  const up = estimate.pnlUsd >= 0;
  const emoji = up ? "🟢" : "🔴";
  const usd = `${up ? "+" : "−"}$${Math.abs(estimate.pnlUsd).toFixed(2)}`;
  const pct =
    estimate.pnlPct === null
      ? ""
      : `${estimate.pnlPct >= 0 ? "+" : "−"}${Math.abs(estimate.pnlPct).toFixed(1)}% PnL | `;
  const entry =
    snap && typeof snap.entrySpotUsd === "number"
      ? ` | Entry: $${snap.entrySpotUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
      : "";
  return `${emoji} ${header}\n${pct}${usd}${entry}`;
}
