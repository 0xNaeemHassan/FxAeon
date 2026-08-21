/**
 * Wallet balances used by onboarding and the Mini App.
 *
 * The official SDK accepts more than the two market collateral tokens, so the
 * gateway reads every supported Ethereum-side asset. Core portfolio fields
 * remain backward-compatible; individual secondary-token failures are exposed
 * as null rather than collapsing the whole account into a fake zero.
 */
import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { mainnet } from "viem/chains";
import {
  PROTOCOL_TOKENS,
  type ProtocolTokenSymbol,
} from "@fxaeon/shared";
import { getConfig } from "../middleware/config.js";

const RPC_TIMEOUT_MS = 5_000;
const ERC20_SYMBOLS = [
  "WETH",
  "stETH",
  "wstETH",
  "WBTC",
  "USDC",
  "USDT",
  "fxUSD",
  "fxSAVE",
  "fxUSDBasePool",
] as const satisfies readonly ProtocolTokenSymbol[];

export type WalletBalances = Partial<Record<ProtocolTokenSymbol, string | null>>;

export type FundingState =
  | { known: false; balances?: WalletBalances }
  | {
      known: true;
      funded: boolean;
      eth: string;
      wstEth: string;
      wbtc: string;
      balances?: WalletBalances;
    };

let client: ReturnType<typeof createPublicClient> | null = null;

function getClient() {
  if (client) return client;
  const cfg = getConfig();
  client = createPublicClient({
    chain: mainnet,
    transport: http(cfg.ALCHEMY_RPC_URL, { timeout: RPC_TIMEOUT_MS }),
  });
  return client;
}

export function __resetFundingClientForTests(): void {
  client = null;
}

export async function getFundingState(address: `0x${string}`): Promise<FundingState> {
  try {
    const c = getClient();
    const settled = await Promise.allSettled([
      c.getBalance({ address }),
      ...ERC20_SYMBOLS.map((symbol) => {
        const token = PROTOCOL_TOKENS[symbol];
        return c.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        });
      }),
    ]);

    const balances: WalletBalances = {};
    const ethResult = settled[0];
    balances.ETH =
      ethResult.status === "fulfilled" ? formatUnits(ethResult.value as bigint, 18) : null;

    ERC20_SYMBOLS.forEach((symbol, index) => {
      const result = settled[index + 1];
      balances[symbol] =
        result.status === "fulfilled"
          ? formatUnits(result.value as bigint, PROTOCOL_TOKENS[symbol].decimals)
          : null;
    });

    // Existing portfolio valuation depends on precisely these three fields.
    // If one is unknown, keep the previous fail-closed `known:false` contract.
    if (balances.ETH === null || balances.wstETH === null || balances.WBTC === null) {
      return { known: false, balances };
    }

    const funded = Object.values(balances).some(isPositiveDecimalString);
    return {
      known: true,
      funded,
      eth: balances.ETH!,
      wstEth: balances.wstETH!,
      wbtc: balances.WBTC!,
      balances,
    };
  } catch {
    return { known: false };
  }
}

export function describeFunding(state: FundingState): string {
  if (!state.known) return "";
  if (!state.funded) {
    return (
      "\n\n💰 Your wallet is empty. Fund it to start:\n" +
      "• Send a supported asset on Ethereum mainnet\n" +
      "• /deposit shows your address and QR code"
    );
  }
  const balances = state.balances ?? {
    ETH: state.eth,
    wstETH: state.wstEth,
    WBTC: state.wbtc,
  };
  const parts = Object.entries(balances)
    .filter(([, value]) => isPositiveDecimalString(value))
    .slice(0, 4)
    .map(([symbol, value]) => `${trim(value as string)} ${symbol}`);
  return `\n\n💰 Balance: ${parts.join(" · ")}\nReady — try /trade, /save or /portfolio.`;
}

function trim(v: string): string {
  const n = Number(v);
  return n >= 1
    ? n.toFixed(4).replace(/\.?0+$/, "")
    : n.toPrecision(4).replace(/\.?0+$/, "");
}

/** Exact positive check for canonical decimal strings returned by viem. */
export function isPositiveDecimalString(value: string | null | undefined): value is string {
  return typeof value === "string" && /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) && /[1-9]/.test(value);
}
