import type { FxSdkMarket } from "./tokens";
import { assertConfiguredPublicClientChain, assertPublicClientChain, getEthereumClient } from "./clients";
import { positionPoolAddress } from "./policy";
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

/**
 * The fallback is only used while an RPC is unavailable. It is a deliberately
 * conservative guard matching the current deployed pool ranges; a configured
 * RPC always replaces it with the live on-chain range before signing.
 */
export const FALLBACK_LEVERAGE_BOUNDS: Readonly<Record<`${FxSdkMarket}:${FxPositionSide}`, LeverageBounds>> = {
  "ETH:long": { min: 1.1, max: 6.8, source: "fallback" },
  "BTC:long": { min: 1.1, max: 6.8, source: "fallback" },
  // Short-pool SDK inputs are LSD leverage (the SDK adds 1× internally).
  "ETH:short": { min: 0.1, max: 6.9, source: "fallback" },
  "BTC:short": { min: 0.1, max: 6.9, source: "fallback" },
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

export function leverageBoundsFromRatios(minRatio: bigint, maxRatio: bigint, side: FxPositionSide): LeverageBounds {
  if (minRatio < 0n || maxRatio <= minRatio || maxRatio >= WAD) {
    throw new RangeError("Pool leverage limits returned an invalid debt-ratio range.");
  }
  const sdkOffset = side === "short" ? 1 : 0;
  const minRaw = ratioToLeverage(minRatio) - sdkOffset;
  const maxRaw = ratioToLeverage(maxRatio) - sdkOffset;
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
  return leverageBoundsFromRatios(result[0], result[1], side);
}

export function leverageBoundsFor(market: FxSdkMarket, side: FxPositionSide): LeverageBounds {
  return FALLBACK_LEVERAGE_BOUNDS[`${market}:${side}`];
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
