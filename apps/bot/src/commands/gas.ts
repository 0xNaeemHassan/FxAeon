/**
 * /gas — REAL current Ethereum gas prices.
 *
 * Primary: Etherscan Gas Oracle (free tier, 12s cache) — returns slow/standard/
 * fast tiers plus base fee, block number, and network utilization.
 * Fallback: viem RPC estimateFeesPerGas (EIP-1559 fee data from the node).
 *
 * When Etherscan provides ETH/USD prices, we also show the cost in USD for a
 * typical bot trade. No fabricated numbers: if both sources fail, says so.
 */
import { Context } from "grammy";
import { formatGwei } from "viem";
import { createPublicClientForUser } from "../fx/index.js";
import {
  getGasOracleWithPrice,
  formatGweiPrice,
  formatEthCost,
  formatUsdCost,
  formatGasUsedRatio,
  type GasOracleSnapshot,
} from "@fxbot/shared";

/** Typical gas used by an approve + Router call route (observed range). */
const TYPICAL_TRADE_GAS = 600_000;

/** Format the full gas report from Etherscan data. */
function formatEtherscanGas(snapshot: GasOracleSnapshot): string {
  const { oracle, ethPrice, stale } = snapshot;

  const lines: string[] = [];
  lines.push(`⛽ Gas Prices (live from Etherscan)`);
  if (stale) lines.push(`⚠️ Cached data — Etherscan API temporarily unavailable`);
  lines.push(``);

  // Speed tiers
  lines.push(`🐢 Safe:     ${formatGweiPrice(oracle.safeGasPrice)} gwei`);
  lines.push(`⚡ Standard: ${formatGweiPrice(oracle.proposeGasPrice)} gwei`);
  lines.push(`🚀 Fast:     ${formatGweiPrice(oracle.fastGasPrice)} gwei`);
  lines.push(``);

  // Base fee
  lines.push(`📊 Base fee: ${formatGweiPrice(oracle.suggestBaseFee)} gwei`);

  // Network utilization
  if (oracle.gasUsedRatio.length > 0) {
    lines.push(`📈 Network load: ${formatGasUsedRatio(oracle.gasUsedRatio)} avg (last ${oracle.gasUsedRatio.length} blocks)`);
  }

  // Block number
  lines.push(`🧱 Block: #${oracle.lastBlock.toLocaleString()}`);
  lines.push(``);

  // Trade cost estimate
  lines.push(`💰 Typical bot trade (~${TYPICAL_TRADE_GAS.toLocaleString()} gas):`);
  const ethCostSafe = formatEthCost(oracle.safeGasPrice, TYPICAL_TRADE_GAS);
  const ethCostFast = formatEthCost(oracle.fastGasPrice, TYPICAL_TRADE_GAS);
  lines.push(`   Safe:  ≤ ${ethCostSafe} ETH`);
  lines.push(`   Fast:  ≤ ${ethCostFast} ETH`);

  if (ethPrice) {
    const usdSafe = formatUsdCost(oracle.safeGasPrice, TYPICAL_TRADE_GAS, ethPrice.ethUsd);
    const usdFast = formatUsdCost(oracle.fastGasPrice, TYPICAL_TRADE_GAS, ethPrice.ethUsd);
    lines.push(`   Safe:  ≈ ${usdSafe}`);
    lines.push(`   Fast:  ≈ ${usdFast}`);
    lines.push(``);
    lines.push(`📌 ETH: $${ethPrice.ethUsd.toLocaleString()} | ${ethPrice.ethBtc} BTC`);
  }

  lines.push(``);
  lines.push(`Actual cost is shown by simulation when you confirm a trade.`);

  return lines.join("\n");
}

/** Fallback: RPC-based gas estimate (original implementation). */
async function rpcFallbackGas(): Promise<string> {
  const client = createPublicClientForUser("off");
  const fees = await client.estimateFeesPerGas();
  const base = fees.maxFeePerGas - fees.maxPriorityFeePerGas;
  const fmt = (wei: bigint) => Number(formatGwei(wei)).toFixed(2);
  const tradeCostEth = Number(fees.maxFeePerGas * BigInt(TYPICAL_TRADE_GAS)) / 1e18;

  return (
    `⛽ Gas (live from RPC)\n\n` +
    `Base fee: ${fmt(base)} gwei\n` +
    `Priority tip: ${fmt(fees.maxPriorityFeePerGas)} gwei\n` +
    `Max fee: ${fmt(fees.maxFeePerGas)} gwei\n\n` +
    `Typical bot trade (~${TYPICAL_TRADE_GAS.toLocaleString()} gas): ≤ ${tradeCostEth.toFixed(5)} ETH\n\n` +
    `Actual cost is shown by simulation when you confirm a trade.`
  );
}

export async function gasCommand(ctx: Context): Promise<void> {
  try {
    // Try Etherscan first (richer data: tiers, block, utilization, USD cost)
    if (process.env.ETHERSCAN_API_KEY) {
      try {
        const snapshot = await getGasOracleWithPrice();
        await ctx.reply(formatEtherscanGas(snapshot));
        return;
      } catch {
        // Fall through to RPC
      }
    }

    // Fallback: RPC-only gas (still real, just fewer details)
    const message = await rpcFallbackGas();
    await ctx.reply(message);
  } catch {
    await ctx.reply(
      `⛽ Gas\n\n❌ Couldn't fetch live gas prices right now. Please try again.`
    );
  }
}
