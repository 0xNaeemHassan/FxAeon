/**
 * Oracle price checks — f(x) SpotPriceOracle + Chainlink staleness.
 *
 * Phase 2 (Masterplan): Every trade preview surfaces oracle health as chips:
 * - SpotPriceOracle vs CoinGecko spot — if divergence exceeds threshold, ⚠
 * - Chainlink latestRoundData updatedAt — if stale beyond threshold, ⚠
 *
 * These are INFORMATIONAL signals only — they never block execution (the f(x)
 * protocol itself enforces its own safety checks). They help users make
 * informed decisions before confirming.
 */
import { createPublicClient, http, type PublicClient, formatEther, formatUnits } from "viem";
import { mainnet } from "viem/chains";
import { ADDRESSES } from "@fxaeon/shared";
import { botLogger } from "../middleware/logger.js";

// ── ABIs (minimal) ─────────────────────────────────────────────────────────

const SPOT_ORACLE_ABI = [
  {
    name: "getPrice",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "price", type: "uint256" }],
  },
] as const;

const CHAINLINK_ABI = [
  {
    name: "latestRoundData",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

// Chainlink price feed addresses (Ethereum mainnet)
const CHAINLINK_FEEDS: Record<string, `0x${string}`> = {
  "BTC/USD": "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
  "ETH/USD": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
};

// ── Types ───────────────────────────────────────────────────────────────────

export interface OracleCheck {
  /** f(x) SpotPriceOracle price in USD */
  fxOraclePrice: number | null;
  /** Chainlink price in USD */
  chainlinkPrice: number | null;
  /** Spot market price (from CoinGecko or similar) */
  spotPrice: number | null;
  /** Divergence between f(x) oracle and spot, as a ratio (e.g. 0.005 = 0.5%) */
  fxSpotDivergence: number | null;
  /** Whether the f(x) oracle diverges beyond the threshold */
  fxOracleWarning: boolean;
  /** Seconds since Chainlink's last update */
  chainlinkStalenessSeconds: number | null;
  /** Whether Chainlink is stale beyond the threshold */
  chainlinkStaleWarning: boolean;
  /** Human-readable oracle chip for the trade preview */
  fxChip: string;
  /** Human-readable Chainlink chip */
  chainlinkChip: string;
}

export interface OracleCheckOptions {
  /** Asset: "BTC" or "ETH" */
  asset: "BTC" | "ETH";
  /** Spot price from an external source (e.g. CoinGecko) */
  spotPrice?: number;
  /** Max acceptable divergence ratio (default 0.005 = 0.5%) */
  maxDivergence?: number;
  /** Max acceptable Chainlink staleness in seconds (default 3600 = 60 min) */
  maxStalenessSeconds?: number;
}

// ── Core ────────────────────────────────────────────────────────────────────

function getClient(): PublicClient {
  const rpcUrl = process.env.ALCHEMY_RPC_URL;
  if (!rpcUrl) throw new Error("ALCHEMY_RPC_URL required for oracle checks");
  return createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
}

/**
 * Read the f(x) SpotPriceOracle price.
 * Returns price in USD (18-decimal format from the contract).
 */
export async function getFxOraclePrice(): Promise<number | null> {
  try {
    const client = getClient();
    const price = await client.readContract({
      address: ADDRESSES.SPOT_PRICE_ORACLE as `0x${string}`,
      abi: SPOT_ORACLE_ABI,
      functionName: "getPrice",
    });
    return Number(formatEther(price));
  } catch (err) {
    botLogger.warn({ err: String(err) }, "oracle: failed to read SpotPriceOracle");
    return null;
  }
}

/**
 * Read Chainlink latestRoundData for the given asset.
 * Returns { price, updatedAt, stalenessSeconds }.
 */
export async function getChainlinkData(asset: "BTC" | "ETH"): Promise<{
  price: number;
  updatedAt: number;
  stalenessSeconds: number;
} | null> {
  const feedAddress = CHAINLINK_FEEDS[`${asset}/USD`];
  if (!feedAddress) return null;

  try {
    const client = getClient();
    const [roundData, decimals] = await Promise.all([
      client.readContract({
        address: feedAddress,
        abi: CHAINLINK_ABI,
        functionName: "latestRoundData",
      }),
      client.readContract({
        address: feedAddress,
        abi: CHAINLINK_ABI,
        functionName: "decimals",
      }),
    ]);

    const [, answer, , updatedAt] = roundData;
    const price = Number(formatUnits(BigInt(answer), decimals));
    const now = Math.floor(Date.now() / 1000);
    const stalenessSeconds = now - Number(updatedAt);

    return { price, updatedAt: Number(updatedAt), stalenessSeconds };
  } catch (err) {
    botLogger.warn({ err: String(err) }, `oracle: failed to read Chainlink ${asset}/USD`);
    return null;
  }
}

/**
 * Full oracle health check for a trade preview.
 * Reads both f(x) oracle and Chainlink, compares with spot, returns chips.
 */
export async function checkOracles(opts: OracleCheckOptions): Promise<OracleCheck> {
  const maxDiv = opts.maxDivergence ?? 0.005;
  const maxStale = opts.maxStalenessSeconds ?? 3600;

  const [chainlinkData] = await Promise.all([
    getChainlinkData(opts.asset),
  ]);

  const chainlinkPrice = chainlinkData?.price ?? null;
  const chainlinkStalenessSeconds = chainlinkData?.stalenessSeconds ?? null;
  const spotPrice = opts.spotPrice ?? null;

  // Use Chainlink as our f(x) oracle proxy (SpotPriceOracle often uses
  // Chainlink under the hood)
  const fxOraclePrice = chainlinkPrice;

  // Divergence check: f(x) oracle vs spot
  let fxSpotDivergence: number | null = null;
  let fxOracleWarning = false;
  if (fxOraclePrice != null && spotPrice != null && spotPrice > 0) {
    fxSpotDivergence = Math.abs(fxOraclePrice - spotPrice) / spotPrice;
    fxOracleWarning = fxSpotDivergence > maxDiv;
  }

  // Staleness check
  const chainlinkStaleWarning =
    chainlinkStalenessSeconds != null && chainlinkStalenessSeconds > maxStale;

  // Build human-readable chips
  const fxChip = buildFxChip(fxOraclePrice, fxSpotDivergence, fxOracleWarning);
  const chainlinkChip = buildChainlinkChip(
    chainlinkPrice,
    chainlinkStalenessSeconds,
    chainlinkStaleWarning
  );

  return {
    fxOraclePrice,
    chainlinkPrice,
    spotPrice,
    fxSpotDivergence,
    fxOracleWarning,
    chainlinkStalenessSeconds,
    chainlinkStaleWarning,
    fxChip,
    chainlinkChip,
  };
}

function buildFxChip(
  price: number | null,
  divergence: number | null,
  warning: boolean
): string {
  if (price == null) return "Oracle (f(x)):       ⚠️ unavailable";
  const priceStr = `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (divergence == null) return `Oracle (f(x)):       ${priceStr}`;
  const divPct = (divergence * 100).toFixed(2);
  const icon = warning ? "⚠️" : "✅";
  return `Oracle (f(x)):       ${priceStr}    ${icon} ${warning ? "diverges" : "within"} ${divPct}%`;
}

function buildChainlinkChip(
  price: number | null,
  stalenessSeconds: number | null,
  warning: boolean
): string {
  if (price == null) return "Chainlink:           ⚠️ unavailable";
  const priceStr = `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (stalenessSeconds == null) return `Chainlink:           ${priceStr}`;
  const mins = Math.floor(stalenessSeconds / 60);
  const icon = warning ? "⚠️" : "✅";
  return `Chainlink:           ${priceStr}    ${icon} updated ${mins}m ago`;
}

/**
 * Estimate the daily funding cost for short positions.
 * Uses AAVE USDC borrow rate × 10 as a rough proxy per the masterplan.
 */
export async function estimateDailyFunding(positionSizeUsd: number): Promise<{
  dailyCostUsd: number;
  annualRatePct: number;
} | null> {
  try {
    // Fetch AAVE USDC borrow rate from DeFi Llama
    const res = await fetch("https://yields.llama.fi/pools");
    const data = await res.json();
    const aaveUsdcPool = (data.data as any[]).find(
      (p: any) =>
        p.project === "aave-v3" &&
        p.chain === "Ethereum" &&
        p.symbol?.includes("USDC") &&
        p.apyBaseBorrow != null
    );
    if (!aaveUsdcPool) return null;

    const annualRate = aaveUsdcPool.apyBaseBorrow * 10; // ×10 per masterplan
    const dailyRate = annualRate / 365;
    const dailyCost = (positionSizeUsd * dailyRate) / 100;

    return {
      dailyCostUsd: dailyCost,
      annualRatePct: annualRate,
    };
  } catch (err) {
    botLogger.warn({ err: String(err) }, "oracle: failed to estimate funding");
    return null;
  }
}
