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

/**
 * USD value of an fxSAVE (stability-pool) holding from its underlying assets.
 * fxSAVE is an ERC-4626 vault over fxUSD, so the SDK's `assetsWei` already is
 * the position's redeemable fxUSD — we only convert fxUSD→USD (its live price,
 * or $1.00 when the feed is down, matching the debt convention above).
 *
 * Returns 0 when there is no position (shares ≈ 0), and null when there IS a
 * position but its underlying value can't be priced — so the caller shows an
 * honest "—" instead of dropping a real holding from Total Value.
 */
export function valueSavings(
  shares: string | number | null | undefined,
  assets: string | number | null | undefined,
  prices: Record<string, number | null> | null
): number | null {
  const sharesNum = Number(shares ?? 0);
  if (!(sharesNum > 0)) return 0; // no stability-pool position
  if (!prices) return null;
  const assetsNum = assets === null || assets === undefined ? NaN : Number(assets);
  if (!Number.isFinite(assetsNum)) return null; // SDK couldn't value the shares
  const fxUsdPrice = prices["FXUSD"] ?? 1;
  if (typeof fxUsdPrice !== "number") return null;
  return assetsNum * fxUsdPrice;
}

export interface PortfolioSummary {
  /** Wallet cash + position net equity + stability-pool value. null when anything needed is unpriced. */
  totalValueUsd: number | null;
  /** Wallet token balances in USD. null when unknown or a balance is unpriced. */
  walletUsd: number | null;
  /** Sum of position net equity in USD. null when any position is unpriced. */
  positionsUsd: number | null;
  /** fxSAVE (stability-pool) value in USD. 0 when no position, null when unpriced. */
  savingsUsd: number | null;
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
  prices: Record<string, number | null> | null,
  /** fxSAVE value in USD (0 = no position, null = unpriced). See valueSavings. */
  savingsUsd: number | null = 0
): PortfolioSummary {
  const empty: PortfolioSummary = {
    totalValueUsd: null,
    walletUsd: null,
    positionsUsd: null,
    savingsUsd: null,
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
  let netPnlUsd: number | null = null;
  if (positions.length > 0) {
    let sum = 0;
    let complete = true;
    for (const pnl of pnls) {
      if (!pnl) {
        complete = false;
        break;
      }
      sum += pnl.pnlUsd;
    }
    netPnlUsd = complete ? sum : null;
  }

  const totalValueUsd =
    walletUsd !== null && positionsUsd !== null && savingsUsd !== null
      ? walletUsd + positionsUsd + savingsUsd
      : null;

  // PnL % vs entry position equity (current position equity minus PnL).
  let netPnlPct: number | null = null;
  if (netPnlUsd !== null && positionsUsd !== null) {
    const basis = positionsUsd - netPnlUsd;
    if (Math.abs(basis) > 1e-6) netPnlPct = (netPnlUsd / Math.abs(basis)) * 100;
  }

  return { totalValueUsd, walletUsd, positionsUsd, savingsUsd, netPnlUsd, netPnlPct };
}
