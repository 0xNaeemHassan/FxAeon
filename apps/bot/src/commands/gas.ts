/**
 * /gas — REAL current Ethereum gas prices from the RPC (EIP-1559 fee data),
 * plus a rough cost estimate for a typical bot trade. No fabricated numbers:
 * if the RPC is unavailable, says so.
 */
import { Context } from "grammy";
import { formatGwei } from "viem";
import { createPublicClientForUser } from "../fx/index.js";

/** Typical gas used by an approve + Router call route (observed range). */
const TYPICAL_TRADE_GAS = 600_000n;

export async function gasCommand(ctx: Context): Promise<void> {
  try {
    const client = createPublicClientForUser("off");
    const fees = await client.estimateFeesPerGas();
    const base = fees.maxFeePerGas - fees.maxPriorityFeePerGas;
    const fmt = (wei: bigint) => Number(formatGwei(wei)).toFixed(2);
    const tradeCostEth = Number(fees.maxFeePerGas * TYPICAL_TRADE_GAS) / 1e18;

    await ctx.reply(
      `⛽ Gas (live from RPC)\n\n` +
        `Base fee: ${fmt(base)} gwei\n` +
        `Priority tip: ${fmt(fees.maxPriorityFeePerGas)} gwei\n` +
        `Max fee: ${fmt(fees.maxFeePerGas)} gwei\n\n` +
        `Typical bot trade (~${TYPICAL_TRADE_GAS.toLocaleString()} gas): ≤ ${tradeCostEth.toFixed(5)} ETH\n\n` +
        `Actual cost is shown by simulation when you confirm a trade.`
    );
  } catch {
    await ctx.reply(
      `⛽ Gas\n\n❌ Couldn't fetch live gas prices right now (RPC issue). Please try again.`
    );
  }
}
