/** Chain-derived gas and receipt presentation shared by every Mini App action. */
import { formatUnits } from "viem";
import type { Eip1559Fees, FeeTierKey } from "./fees.js";

const GWEI = 1_000_000_000n;

export interface GasTier {
  key: FeeTierKey;
  maxFeeGwei: number;
  priorityGwei: number;
  estCostWei: string;
  estCostEth: number;
  estCostUsd: number | null;
}

export interface GasEstimate {
  units: string;
  tiers: GasTier[];
  recommended: FeeTierKey;
}

/** Match the executor's per-step 20% gas-limit headroom exactly. */
export function routeGasLimitWithHeadroom(gasUsed: readonly bigint[]): bigint {
  return gasUsed.reduce((total, gas) => total + (gas * 120n) / 100n, 0n);
}

export function gasTierCost(
  totalGas: bigint,
  fee: Eip1559Fees,
  key: FeeTierKey,
  ethPriceUsd: number | null
): GasTier {
  const estCostWei = totalGas * fee.maxFeePerGas;
  const estCostEth = Number(formatUnits(estCostWei, 18));
  return {
    key,
    maxFeeGwei: Number(fee.maxFeePerGas) / Number(GWEI),
    priorityGwei: Number(fee.maxPriorityFeePerGas) / Number(GWEI),
    estCostWei: estCostWei.toString(),
    estCostEth,
    estCostUsd: ethPriceUsd == null ? null : estCostEth * ethPriceUsd,
  };
}

export function buildGasEstimate(
  totalGas: bigint,
  tiers: { slow: Eip1559Fees; market: Eip1559Fees; fast: Eip1559Fees },
  ethPriceUsd: number | null
): GasEstimate {
  return {
    units: totalGas.toString(),
    tiers: [
      gasTierCost(totalGas, tiers.slow, "slow", ethPriceUsd),
      gasTierCost(totalGas, tiers.market, "market", ethPriceUsd),
      gasTierCost(totalGas, tiers.fast, "fast", ethPriceUsd),
    ],
    recommended: "market",
  };
}

export interface TradeReceiptInfo {
  blockNumber: number;
  gasUsed: string;
  effectiveGasPriceGwei: number;
  gasPaidWei: string;
  gasPaidEth: number;
  gasPaidUsd: number | null;
  confirmations: number;
}

export function buildReceiptInfo(
  receipt: { blockNumber: bigint; gasUsed: bigint; effectiveGasPrice: bigint },
  currentBlock: bigint,
  ethPriceUsd: number | null
): TradeReceiptInfo {
  const gasPaidWei = receipt.gasUsed * receipt.effectiveGasPrice;
  const gasPaidEth = Number(formatUnits(gasPaidWei, 18));
  const confirmations = Math.max(1, Number(currentBlock - receipt.blockNumber) + 1);
  return {
    blockNumber: Number(receipt.blockNumber),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceGwei: Number(receipt.effectiveGasPrice) / Number(GWEI),
    gasPaidWei: gasPaidWei.toString(),
    gasPaidEth,
    gasPaidUsd: ethPriceUsd == null ? null : gasPaidEth * ethPriceUsd,
    confirmations,
  };
}

interface ReceiptReader {
  getTransactionReceipt: (args: { hash: `0x${string}` }) => Promise<{
    blockNumber: bigint;
    gasUsed: bigint;
    effectiveGasPrice: bigint;
  } | null>;
  getBlockNumber: () => Promise<bigint>;
}

export async function readTradeReceipt(
  client: ReceiptReader,
  hash: `0x${string}`,
  ethPriceUsd: number | null
): Promise<TradeReceiptInfo | null> {
  try {
    const receipt = await client.getTransactionReceipt({ hash });
    if (!receipt) return null;
    const head = await client.getBlockNumber().catch(() => receipt.blockNumber);
    return buildReceiptInfo(receipt, head, ethPriceUsd);
  } catch {
    return null;
  }
}
