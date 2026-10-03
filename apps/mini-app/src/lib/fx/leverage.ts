import type { FxSdkMarket } from "./tokens";
import { assertConfiguredPublicClientChain, assertPublicClientChain, getEthereumClient } from "./clients";
import { positionPoolAddress } from "./policy";
import { DEFAULT_SLIPPAGE_PERCENT } from "../settings";
import type { FxPublicClient } from "./types";

export type FxPositionSide = "long" | "short";

const DEBT_RATIO_ABI = [{
  type: "function",
  name: "getDebtRatioRange",
  stateMutability: "view",
  inputs: [],
  outputs: [{ type: "uint256" }, { type: "uint256" }],
}] as const;

const WAD = 10n ** 18n;
const BPS = 10_000n;
// Leave room for the SDK's internal 100 bps debt-ratio window, then further
// reserve the selected swap slippage. Pool price, conversion impact, and an
// existing position still affect the final SDK check, so this is a guarded UI
// ceiling rather than a guarantee that every route at the ceiling will plan.
const SDK_RATIO_GUARD_BPS = 100n;
const FALLBACK_DEBT_RATIO_RANGES: Readonly<Record<`${FxSdkMarket}:${FxPositionSide}`, readonly [bigint, bigint]>> = {
  "ETH:long": [25_600_000_000_000_000n, 855_000_000_000_000_000n],
  "BTC:long": [25_600_000_000_000_000n, 855_000_000_000_000_000n],
  "ETH:short": [90_909_090_909_090_909n, 875_000_000_000_000_000n],
  "BTC:short": [90_909_090_909_090_909n, 875_000_000_000_000_000n],
};

export interface LeverageBounds {
  min: number;
  max: number;
  source: "live" | "fallback";
}

type LeverageBoundsClient = Pick<FxPublicClient, "getChainId" | "readContract"> & {
  chain?: { id?: number };
};

export type PreparedLeverageReview<T> = {
  adjusted: false;
  bounds: LeverageBounds;
  leverage: number;
  plan: T;
} | {
  adjusted: true;
  bounds: LeverageBounds;
  leverage: number;
  plan: null;
};

function ratioToLeverage(ratio: bigint): number {
  const denominator = ratio >= WAD ? 1n : WAD - ratio;
  return Number(WAD) / Number(denominator);
}

function safeStepUp(value: number): number {
  return Math.max(0.1, Math.ceil((value + 0.001) * 10) / 10);
}

function safeStepDown(value: number): number {
  return Math.max(0.1, Math.floor((value - 0.001) * 10) / 10);
}

function slippageBps(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0 || value > 2) {
    throw new RangeError("Slippage must be greater than 0 and at most 2 percent to calculate leverage bounds.");
  }
  return BigInt(Math.round(value * 100));
}

export function leverageBoundsFromRatios(
  minRatio: bigint,
  maxRatio: bigint,
  side: FxPositionSide,
  slippagePercent = DEFAULT_SLIPPAGE_PERCENT,
): LeverageBounds {
  if (minRatio < 0n || maxRatio <= minRatio || maxRatio >= WAD) {
    throw new RangeError("Pool leverage limits returned an invalid debt-ratio range.");
  }
  const selectedSlippageBps = slippageBps(slippagePercent);
  const sdkOffset = side === "short" ? 1 : 0;
  const minRaw = ratioToLeverage(minRatio) - sdkOffset;
  // The SDK may widen the requested route amount by slippage while using the
  // opposite slippage direction for the converted amount. Use the ratio of
  // those factors, plus the SDK's own 100 bps window, as headroom before the
  // editable tenth-step. Do not treat this estimate as route acceptance.
  const guardedMaxRatio = maxRatio
    * (BPS - SDK_RATIO_GUARD_BPS) / BPS
    * (BPS - selectedSlippageBps) / (BPS + selectedSlippageBps);
  const maxRaw = ratioToLeverage(guardedMaxRatio) - sdkOffset;
  // The SDK rejects zero, while 0.1× is the smallest editable step for an
  // LSD-short request. Long pools retain their live minimum boundary.
  const min = side === "short" ? 0.1 : safeStepUp(minRaw);
  const max = safeStepDown(maxRaw);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
    throw new RangeError("Pool leverage limits do not contain a safe 0.1x target.");
  }
  return { min, max, source: "live" };
}

export async function readLeverageBounds(
  market: FxSdkMarket,
  side: FxPositionSide,
  client?: LeverageBoundsClient,
  slippagePercent = DEFAULT_SLIPPAGE_PERCENT,
): Promise<LeverageBounds> {
  if (client) await assertPublicClientChain(client, 1);
  else await assertConfiguredPublicClientChain(1);
  const reader = client ?? getEthereumClient();
  const result = await reader.readContract({
    address: positionPoolAddress(market, side),
    abi: DEBT_RATIO_ABI,
    functionName: "getDebtRatioRange",
  });
  if (!Array.isArray(result) || result.length < 2 || typeof result[0] !== "bigint" || typeof result[1] !== "bigint") {
    throw new Error("Pool leverage limits returned an invalid response.");
  }
  return leverageBoundsFromRatios(result[0], result[1], side, slippagePercent);
}

export const FALLBACK_LEVERAGE_BOUNDS: Readonly<Record<`${FxSdkMarket}:${FxPositionSide}`, LeverageBounds>> = Object.fromEntries(
  Object.entries(FALLBACK_DEBT_RATIO_RANGES).map(([key, [minRatio, maxRatio]]) => [
    key,
    { ...leverageBoundsFromRatios(minRatio, maxRatio, key.endsWith(":short") ? "short" : "long"), source: "fallback" as const },
  ]),
) as Readonly<Record<`${FxSdkMarket}:${FxPositionSide}`, LeverageBounds>>;

export function leverageBoundsFor(
  market: FxSdkMarket,
  side: FxPositionSide,
  slippagePercent = DEFAULT_SLIPPAGE_PERCENT,
): LeverageBounds {
  const [minRatio, maxRatio] = FALLBACK_DEBT_RATIO_RANGES[`${market}:${side}`];
  return { ...leverageBoundsFromRatios(minRatio, maxRatio, side, slippagePercent), source: "fallback" };
}

export function clampLeverage(value: number, bounds: Pick<LeverageBounds, "min" | "max">): number {
  if (!Number.isFinite(value)) return bounds.min;
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

/**
 * Start route pricing and the small live bounds read together. This keeps the
 * quote path fast while ensuring a limit changed since form entry can never
 * reach the review/signing stage unnoticed.
 */
export async function prepareLeverageReview<T>({
  leverage,
  currentBounds,
  readBounds,
  buildPlan,
}: {
  leverage: number;
  currentBounds: LeverageBounds;
  readBounds: () => Promise<LeverageBounds>;
  buildPlan: () => Promise<T>;
}): Promise<PreparedLeverageReview<T>> {
  const planPromise = buildPlan();
  // A newly tightened pool range can make the SDK planner reject before the
  // bounds read settles. Attach a handler immediately, then surface the same
  // rejection below if the requested target is still valid.
  void planPromise.catch(() => undefined);
  const bounds = await readBounds().catch(() => currentBounds);
  const adjustedLeverage = clampLeverage(leverage, bounds);
  if (adjustedLeverage !== leverage) {
    await planPromise.catch(() => undefined);
    return { adjusted: true, bounds, leverage: adjustedLeverage, plan: null };
  }
  return { adjusted: false, bounds, leverage, plan: await planPromise };
}
