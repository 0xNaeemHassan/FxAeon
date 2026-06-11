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
