/**
 * EIP-1559 fee estimation from eth_feeHistory (W-11).
 *
 * Non-negotiable from PLAN.md: fees come from feeHistory, bigint-only math.
 * - tip = median of the 50th-percentile priority fees over recent blocks,
 *   clamped to [0.1 gwei, 10 gwei] so a single weird block can neither starve
 *   nor drain the user.
 * - maxFeePerGas = 2 * nextBaseFee + tip (survives 2 consecutive 12.5%
 *   base-fee increases with a wide margin; unused fee is refunded by protocol).
 */
import type { PublicClient } from "viem";

export interface Eip1559Fees {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  /** Projected base fee of the next block (last entry of feeHistory). */
  nextBaseFee: bigint;
}

const GWEI = 1_000_000_000n;
export const MIN_PRIORITY_FEE_WEI = GWEI / 10n; // 0.1 gwei
export const MAX_PRIORITY_FEE_WEI = 10n * GWEI; // 10 gwei

export function medianBigint(values: bigint[]): bigint {
  if (values.length === 0) throw new Error("medianBigint: empty input");
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2n;
}

export function clampBigint(value: bigint, min: bigint, max: bigint): bigint {
  return value < min ? min : value > max ? max : value;
}

export async function getEip1559Fees(
  client: Pick<PublicClient, "getFeeHistory">,
  opts: { blockCount?: number } = {}
): Promise<Eip1559Fees> {
  const history = await client.getFeeHistory({
    blockCount: opts.blockCount ?? 10,
    rewardPercentiles: [50],
  });

  // baseFeePerGas has blockCount + 1 entries; the last one is the next block.
  const nextBaseFee = history.baseFeePerGas.at(-1);
  if (nextBaseFee === undefined || nextBaseFee <= 0n) {
    throw new Error("feeHistory returned no usable baseFeePerGas — refusing to guess fees");
  }

  const rewards = (history.reward ?? [])
    .map((perBlock) => perBlock[0])
    .filter((r): r is bigint => typeof r === "bigint");
  // Empty-block periods can yield zero rewards; the floor keeps us includable.
  const tip = clampBigint(
    rewards.length > 0 ? medianBigint(rewards) : MIN_PRIORITY_FEE_WEI,
    MIN_PRIORITY_FEE_WEI,
    MAX_PRIORITY_FEE_WEI
  );

  return {
    maxFeePerGas: 2n * nextBaseFee + tip,
    maxPriorityFeePerGas: tip,
    nextBaseFee,
  };
}

// ── Slow / Market / Fast tiers (real, from feeHistory percentiles) ──────────
//
// MetaMask-style speed tiers: the *only* honest difference between tiers is the
// priority tip (how generously you bid for faster inclusion). We read the
// 10th / 50th / 90th percentile priority fees from recent blocks and clamp each
// to the same [0.1, 10] gwei band. The base-fee buffer (2× nextBaseFee) is
// identical across tiers — it protects against base-fee swings, not speed.
// Nothing is fabricated; if feeHistory has no usable base fee we throw.

export type FeeTierKey = "slow" | "market" | "fast";

export interface Eip1559FeeTiers {
  nextBaseFee: bigint;
  slow: Eip1559Fees;
  market: Eip1559Fees;
  fast: Eip1559Fees;
}

/** Pure tier math, split out so it can be unit-tested without a chain. */
export function computeFeeTiers(
  nextBaseFee: bigint,
  tips: { slow: bigint; market: bigint; fast: bigint }
): Eip1559FeeTiers {
  if (nextBaseFee <= 0n) throw new Error("computeFeeTiers: nextBaseFee must be positive");
  // Clamp first, then enforce monotonicity so slow ≤ market ≤ fast even when a
  // quiet mempool flattens the percentiles below the floor.
  const slowTip = clampBigint(tips.slow, MIN_PRIORITY_FEE_WEI, MAX_PRIORITY_FEE_WEI);
  const marketTip = clampBigint(
    tips.market > slowTip ? tips.market : slowTip,
    MIN_PRIORITY_FEE_WEI,
    MAX_PRIORITY_FEE_WEI
  );
  const fastTip = clampBigint(
    tips.fast > marketTip ? tips.fast : marketTip,
    MIN_PRIORITY_FEE_WEI,
    MAX_PRIORITY_FEE_WEI
  );
  const mk = (tip: bigint): Eip1559Fees => ({
    maxPriorityFeePerGas: tip,
    maxFeePerGas: 2n * nextBaseFee + tip,
    nextBaseFee,
  });
  return { nextBaseFee, slow: mk(slowTip), market: mk(marketTip), fast: mk(fastTip) };
}

export async function getEip1559FeeTiers(
  client: Pick<PublicClient, "getFeeHistory">,
  opts: { blockCount?: number } = {}
): Promise<Eip1559FeeTiers> {
  const history = await client.getFeeHistory({
    blockCount: opts.blockCount ?? 10,
    rewardPercentiles: [10, 50, 90],
  });
  const nextBaseFee = history.baseFeePerGas.at(-1);
  if (nextBaseFee === undefined || nextBaseFee <= 0n) {
    throw new Error("feeHistory returned no usable baseFeePerGas — refusing to guess fees");
  }
  // Median of each percentile column across the sampled blocks.
  const tipAt = (col: number): bigint => {
    const rewards = (history.reward ?? [])
      .map((perBlock) => perBlock[col])
      .filter((r): r is bigint => typeof r === "bigint");
    return rewards.length > 0 ? medianBigint(rewards) : MIN_PRIORITY_FEE_WEI;
  };
  return computeFeeTiers(nextBaseFee, { slow: tipAt(0), market: tipAt(1), fast: tipAt(2) });
}

/** Select one tier by key (server-authoritative — the client only sends intent). */
export function selectFeeTier(tiers: Eip1559FeeTiers, key: FeeTierKey): Eip1559Fees {
  return tiers[key];
}
