/**
 * W-18: on-chain portfolio reads — the chain is the source of truth.
 *
 * The old /portfolio rendered `prisma.position` rows, but nothing in the
 * trade flow ever wrote them, so the command always showed an empty (or
 * stale) portfolio. We now read PoolManager state via the f(x) SDK
 * (`getPositions`) for every market × side and derive risk from what the
 * chain reports.
 *
 * Failure honesty: each market/side read fails soft and is surfaced to the
 * caller as a named failure — we never present a partial read as "no
 * positions".
 */
import { formatUnits } from "viem";
import type { FxSdk, PositionInfo } from "@aladdindao/fx-sdk";
import { MARKETS, computeHealthPercent, type Market } from "@fxbot/shared";
import { getPositions } from "../fx/index.js";

export type Side = "long" | "short";

export interface OnChainPosition {
  market: Market;
  side: Side;
  positionId: number;
  /** Collateral in human units of `collateralToken`. */
  collateral: number;
  /** Exact on-chain collateral in wei units (used for full closes). */
  rawCollateral: bigint;
  collateralToken: string;
  /** Debt in human units of `debtToken` (fxUSD). */
  debt: number;
  debtToken: string;
  leverage: number;
  /**
   * Debt ratio derived from on-chain leverage: lev = collValue / equity
   * ⇒ debtRatio = 1 − 1/lev. Exact for the protocol's own leverage figure;
   * we don't pretend to more precision than the chain gives us.
   */
  debtRatio: number;
  /** Risk meter 0–1+ (1.0 = at liquidation threshold). */
  health: number;
}

export interface PortfolioReadResult {
  positions: OnChainPosition[];
  /** Human-readable descriptions of market/side reads that failed. */
  failures: string[];
}

export function deriveDebtRatio(leverage: number): number {
  if (!Number.isFinite(leverage) || leverage <= 1) return 0;
  return 1 - 1 / leverage;
}

function toOnChainPosition(market: Market, side: Side, p: PositionInfo): OnChainPosition {
  const leverage = p.currentLeverage;
  const debtRatio = deriveDebtRatio(leverage);
  return {
    market,
    side,
    positionId: p.positionId,
    collateral: Number(formatUnits(p.rawColls, p.rawCollsDecimals)),
    rawCollateral: p.rawColls,
    collateralToken: p.rawCollsToken || market,
    debt: Number(formatUnits(p.rawDebts, p.rawDebtsDecimals)),
    debtToken: p.rawDebtsToken || "fxUSD",
    leverage,
    debtRatio,
    health: computeHealthPercent(debtRatio),
  };
}

const SIDES: Side[] = ["long", "short"];

export async function fetchOnChainPositions(
  sdk: FxSdk,
  userAddress: string
): Promise<PortfolioReadResult> {
  const combos = MARKETS.flatMap((market) => SIDES.map((side) => ({ market, side })));
  const settled = await Promise.allSettled(
    combos.map(({ market, side }) => getPositions(sdk, userAddress, market, side))
  );

  const positions: OnChainPosition[] = [];
  const failures: string[] = [];
  settled.forEach((res, i) => {
    const { market, side } = combos[i];
    if (res.status === "rejected") {
      failures.push(`${market} ${side}`);
      return;
    }
    for (const p of res.value) {
      // Closed/empty slots can come back with zero collateral — skip them.
      if (p.rawColls === 0n) continue;
      positions.push(toOnChainPosition(market, side, p));
    }
  });

  return { positions, failures };
}

/**
 * Find one of the user's own on-chain positions. Used by the close flow so a
 * tampered callback can never touch anything but the presser's own position.
 */
export async function findUserPosition(
  sdk: FxSdk,
  userAddress: string,
  market: Market,
  side: Side,
  positionId: number
): Promise<OnChainPosition | undefined> {
  const raw = await getPositions(sdk, userAddress, market, side);
  const hit = raw.find((p) => p.positionId === positionId && p.rawColls > 0n);
  return hit ? toOnChainPosition(market, side, hit) : undefined;
}
