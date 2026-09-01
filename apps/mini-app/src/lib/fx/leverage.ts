import type { FxSdkMarket } from "./tokens";
import { assertConfiguredPublicClientChain, getEthereumClient } from "./clients";
import type { FxPublicClient } from "./types";

export type FxPositionSide = "long" | "short";

/** Pool addresses are the Ethereum deployments used by the pinned SDK. */
const POOL_ADDRESS: Record<`${FxSdkMarket}:${FxPositionSide}`, `0x${string}`> = {
  "ETH:long": "0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8",
  "BTC:long": "0xAB709e26Fa6B0A30c119D8c55B887DeD24952473",
  "ETH:short": "0x25707b9e6690B52C60aE6744d711cf9C1dFC1876",
  "BTC:short": "0xA0cC8162c523998856D59065fAa254F87D20A5b0",
};

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
  const sdkOffset = side === "short" ? 1 : 0;
  const minRaw = ratioToLeverage(minRatio) - sdkOffset;
  const maxRaw = ratioToLeverage(maxRatio) - sdkOffset;
  // The SDK rejects zero, while 0.1× is the smallest editable step for an
  // LSD-short request. Long pools retain their live minimum boundary.
  const min = side === "short" ? 0.1 : safeStepUp(minRaw);
  const max = Math.max(min, safeStepDown(maxRaw));
  return { min, max, source: "live" };
}

export async function readLeverageBounds(
  market: FxSdkMarket,
  side: FxPositionSide,
  client?: Pick<FxPublicClient, "readContract">,
): Promise<LeverageBounds> {
  await assertConfiguredPublicClientChain(1);
  const reader = client ?? getEthereumClient();
  const result = await reader.readContract({
    address: POOL_ADDRESS[`${market}:${side}`],
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
