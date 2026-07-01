/**
 * Collateral selector — multicall3 wallet balance reads.
 *
 * Phase 2 (Masterplan): Step 3 of the trade ladder shows the user's wallet
 * balances for LEGAL collateral tokens only. Uses viem multicall3 to batch
 * all balance reads into a single RPC call.
 *
 * Legal collateral per market (per f(x) protocol rules):
 * - ETH market (wstETH): wstETH, stETH, WETH, ETH
 * - BTC market (WBTC): WBTC only
 * - Both markets: fxUSD (always accepted as primary collateral)
 */
import { createPublicClient, http, formatEther, formatUnits, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { ADDRESSES, type Market } from "@fxaeon/shared";
import { botLogger } from "../middleware/logger.js";

// ── ERC-20 balance ABI ──────────────────────────────────────────────────────

const ERC20_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

// ── Collateral token definitions ────────────────────────────────────────────

export interface CollateralToken {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
  /** Whether this is the native ETH (uses getBalance, not balanceOf) */
  isNative: boolean;
}

/** Legal collateral tokens per market */
const ETH_MARKET_TOKENS: CollateralToken[] = [
  { symbol: "fxUSD", address: ADDRESSES.FXUSD as `0x${string}`, decimals: 18, isNative: false },
  { symbol: "wstETH", address: ADDRESSES.WSTETH as `0x${string}`, decimals: 18, isNative: false },
  { symbol: "stETH", address: ADDRESSES.STETH as `0x${string}`, decimals: 18, isNative: false },
  { symbol: "WETH", address: ADDRESSES.WETH as `0x${string}`, decimals: 18, isNative: false },
  { symbol: "ETH", address: ADDRESSES.ETH as `0x${string}`, decimals: 18, isNative: true },
];

const BTC_MARKET_TOKENS: CollateralToken[] = [
  { symbol: "fxUSD", address: ADDRESSES.FXUSD as `0x${string}`, decimals: 18, isNative: false },
  { symbol: "WBTC", address: ADDRESSES.WBTC as `0x${string}`, decimals: 8, isNative: false },
];

export function getCollateralTokens(market: Market): CollateralToken[] {
  return market === "wstETH" ? ETH_MARKET_TOKENS : BTC_MARKET_TOKENS;
}

// ── Balance result ──────────────────────────────────────────────────────────

export interface CollateralBalance {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
  balanceRaw: bigint;
  balanceHuman: number;
  balanceUsd: number | null;
  /** Whether the balance is zero (shown greyed in UI) */
  isEmpty: boolean;
}

// ── Multicall balance fetch ─────────────────────────────────────────────────

function getClient(): PublicClient {
  const rpcUrl = process.env.ALCHEMY_RPC_URL;
  if (!rpcUrl) throw new Error("ALCHEMY_RPC_URL required for collateral reads");
  return createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
}

/**
 * Fetch all legal collateral balances for a user in a single multicall3 batch.
 * Returns balances sorted by value (highest first), with zero-balance tokens
 * marked as isEmpty.
 */
export async function getCollateralBalances(
  userAddress: `0x${string}`,
  market: Market,
  /** Optional USD prices for each token symbol */
  prices?: Record<string, number>
): Promise<CollateralBalance[]> {
  const client = getClient();
  const tokens = getCollateralTokens(market);

  // Build multicall: ERC-20 balanceOf calls + native ETH getBalance
  const erc20Tokens = tokens.filter((t) => !t.isNative);
  const nativeToken = tokens.find((t) => t.isNative);

  try {
    const [erc20Results, ethBalance] = await Promise.all([
      erc20Tokens.length > 0
        ? client.multicall({
            contracts: erc20Tokens.map((t) => ({
              address: t.address,
              abi: ERC20_BALANCE_ABI,
              functionName: "balanceOf" as const,
              args: [userAddress],
            })),
          })
        : Promise.resolve([]),
      nativeToken ? client.getBalance({ address: userAddress }) : Promise.resolve(0n),
    ]);

    const balances: CollateralBalance[] = [];

    // Process ERC-20 results
    erc20Tokens.forEach((token, i) => {
      const result = erc20Results[i];
      const raw = result?.status === "success" ? (result.result as bigint) : 0n;
      const human = Number(formatUnits(raw, token.decimals));
      const usdPrice = prices?.[token.symbol] ?? null;
      balances.push({
        symbol: token.symbol,
        address: token.address,
        decimals: token.decimals,
        balanceRaw: raw,
        balanceHuman: human,
        balanceUsd: usdPrice != null ? human * usdPrice : null,
        isEmpty: raw === 0n,
      });
    });

    // Process native ETH
    if (nativeToken) {
      const human = Number(formatEther(ethBalance));
      const usdPrice = prices?.["ETH"] ?? null;
      balances.push({
        symbol: "ETH",
        address: nativeToken.address,
        decimals: 18,
        balanceRaw: ethBalance,
        balanceHuman: human,
        balanceUsd: usdPrice != null ? human * usdPrice : null,
        isEmpty: ethBalance === 0n,
      });
    }

    // Sort: non-empty first (by USD value desc), then empty
    balances.sort((a, b) => {
      if (a.isEmpty !== b.isEmpty) return a.isEmpty ? 1 : -1;
      const aUsd = a.balanceUsd ?? 0;
      const bUsd = b.balanceUsd ?? 0;
      return bUsd - aUsd;
    });

    return balances;
  } catch (err) {
    botLogger.error({ err: String(err) }, "collateral: multicall failed");
    // Fallback: return tokens with zero balances
    return tokens.map((t) => ({
      symbol: t.symbol,
      address: t.address,
      decimals: t.decimals,
      balanceRaw: 0n,
      balanceHuman: 0,
      balanceUsd: null,
      isEmpty: true,
    }));
  }
}

/**
 * Format a collateral balance for display.
 */
export function formatBalance(bal: CollateralBalance): string {
  if (bal.isEmpty) return `${bal.symbol}: Insufficient`;
  const humanStr =
    bal.balanceHuman >= 1000
      ? bal.balanceHuman.toLocaleString("en-US", { maximumFractionDigits: 2 })
      : bal.balanceHuman.toFixed(bal.decimals <= 8 ? 6 : 4);
  const usdStr =
    bal.balanceUsd != null
      ? `  ≈ $${bal.balanceUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
      : "";
  return `${bal.symbol}: ${humanStr}${usdStr}`;
}
