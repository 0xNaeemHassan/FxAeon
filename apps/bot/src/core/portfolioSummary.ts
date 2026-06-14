/**
 * Portfolio valuation summary — the real numbers behind the Mini App's
 * "Total Value" hero (Screen 4). Pure and honest by construction: every
 * figure is null unless EVERY component it depends on could be priced from
 * the live CoinGecko spot snapshot. No constants, no partial totals dressed
 * up as complete ones (AUDIT P0-3).
 *
 * Valuation convention matches `/portfolio` (commands/portfolio.ts) and the
 * PnL tracker (core/pnl.ts): collateral at live spot, fxUSD debt at its live
 * price when available and $1.00 otherwise.
 */
import type { OnChainPosition } from "./portfolio.js";
import type { FundingState } from "./funding.js";

export interface PositionValuation {
  collateralUsd: number;
  debtUsd: number;
  netUsd: number;
}

/** Live USD value of a single position, or null when a price is missing. */
export function valuePosition(
  pos: Pick<OnChainPosition, "collateral" | "collateralToken" | "debt" | "debtToken">,
  prices: Record<string, number | null>
): PositionValuation | null {
  const colPrice = prices[pos.collateralToken];
  if (typeof colPrice !== "number") return null;
  const debtPrice = pos.debtToken === "fxUSD" ? (prices["FXUSD"] ?? 1) : prices[pos.debtToken];
  if (typeof debtPrice !== "number") return null;
  const collateralUsd = pos.collateral * colPrice;
  const debtUsd = pos.debt * debtPrice;
  return { collateralUsd, debtUsd, netUsd: collateralUsd - debtUsd };
}

export interface PortfolioSummary {
  /** Wallet cash + position net equity. null when anything needed is unpriced. */
  totalValueUsd: number | null;
  /** Wallet token balances in USD. null when unknown or a balance is unpriced. */
  walletUsd: number | null;
  /** Sum of position net equity in USD. null when any position is unpriced. */
  positionsUsd: number | null;
  /** Sum of per-position unrealized PnL. null unless EVERY open position has it. */
  netPnlUsd: number | null;
  /** netPnlUsd as a % of entry position equity. null when not derivable. */
  netPnlPct: number | null;
}

/**
 * Aggregate a wallet + its on-chain positions into display totals.
 * `pnls[i]` is the precomputed unrealized PnL for `positions[i]` (or null when
 * that position can't be priced / has no entry snapshot yet).
 */
export function summarizePortfolio(
  funding: FundingState,
  positions: OnChainPosition[],
  pnls: Array<{ pnlUsd: number } | null>,
  prices: Record<string, number | null> | null
): PortfolioSummary {
  const empty: PortfolioSummary = {
    totalValueUsd: null,
    walletUsd: null,
    positionsUsd: null,
    netPnlUsd: null,
    netPnlPct: null,
  };
  if (!prices) return empty;

  // -- wallet cash --------------------------------------------------------
  let walletUsd: number | null = funding.known ? 0 : null;
  if (funding.known) {
    const legs: Array<[number, number | null]> = [
      [Number(funding.eth), prices["ETH"]],
      [Number(funding.wstEth), prices["wstETH"]],
      [Number(funding.wbtc), prices["WBTC"]],
    ];
    for (const [amount, price] of legs) {
      if (!(amount > 0)) continue; // 0 (or NaN) balance: price irrelevant
      if (typeof price !== "number") {
        walletUsd = null;
        break;
      }
      walletUsd = (walletUsd ?? 0) + amount * price;
    }
  }

  // -- position net equity ------------------------------------------------
  let positionsUsd: number | null = 0;
  for (const p of positions) {
    const v = valuePosition(p, prices);
    if (!v) {
      positionsUsd = null;
      break;
    }
    positionsUsd += v.netUsd;
  }

  // -- unrealized PnL (only when complete across all open positions) ------
  let netPnlUsd: number | null = positions.length > 0 ? 0 : null;
  if (positions.length > 0) {
    for (const pnl of pnls) {
      if (!pnl) {
        netPnlUsd = null;
        break;
      }
      netPnlUsd += pnl.pnlUsd;
    }
  }

  const totalValueUsd =
    walletUsd !== null && positionsUsd !== null ? walletUsd + positionsUsd : null;

  // PnL % vs entry position equity (current position equity minus PnL).
  let netPnlPct: number | null = null;
  if (netPnlUsd !== null && positionsUsd !== null) {
    const basis = positionsUsd - netPnlUsd;
    if (Math.abs(basis) > 1e-6) netPnlPct = (netPnlUsd / Math.abs(basis)) * 100;
  }

  return { totalValueUsd, walletUsd, positionsUsd, netPnlUsd, netPnlPct };
}
