/**
 * Funded-address detection for onboarding empty states (W-16).
 *
 * Reads ETH + collateral (wstETH, WBTC) balances with a hard timeout.
 * Fail-soft: any RPC problem yields { known: false } — onboarding copy then
 * omits balance claims instead of lying (no fabricated numbers, AUDIT P0-3).
 */
import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { mainnet } from "viem/chains";
import { ADDRESSES } from "@fxaeon/shared";
import { getConfig } from "../middleware/config.js";

const RPC_TIMEOUT_MS = 3_000;

export type FundingState =
  | { known: false }
  | {
      known: true;
      funded: boolean;
      eth: string;
      wstEth: string;
      wbtc: string;
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

/** Test hook. */
export function __resetFundingClientForTests(): void {
  client = null;
}

export async function getFundingState(address: `0x${string}`): Promise<FundingState> {
  try {
    const c = getClient();
    const [eth, wstEth, wbtc] = (await Promise.all([
      c.getBalance({ address }),
      c.readContract({
        address: ADDRESSES.WSTETH as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      }),
      c.readContract({
        address: ADDRESSES.WBTC as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      }),
    ])) as [bigint, bigint, bigint];

    return {
      known: true,
      funded: eth > 0n || wstEth > 0n || wbtc > 0n,
      eth: formatUnits(eth, 18),
      wstEth: formatUnits(wstEth, 18),
      wbtc: formatUnits(wbtc, 8),
    };
  } catch {
    return { known: false };
  }
}

/** Short, honest funding line for onboarding messages. */
export function describeFunding(state: FundingState): string {
  if (!state.known) return "";
  if (!state.funded) {
    return (
      "\n\n💰 Your wallet is empty. Fund it to start trading:\n" +
      "• Send ETH, wstETH or WBTC to your address\n" +
      "• /deposit shows your address + QR code"
    );
  }
  const parts: string[] = [];
  if (parseFloat(state.eth) > 0) parts.push(`${trim(state.eth)} ETH`);
  if (parseFloat(state.wstEth) > 0) parts.push(`${trim(state.wstEth)} wstETH`);
  if (parseFloat(state.wbtc) > 0) parts.push(`${trim(state.wbtc)} WBTC`);
  return `\n\n💰 Balance: ${parts.join(" · ")}\nReady to trade — try /trade or /portfolio.`;
}

function trim(v: string): string {
  const n = parseFloat(v);
  return n >= 1 ? n.toFixed(4).replace(/\.?0+$/, "") : n.toPrecision(4).replace(/\.?0+$/, "");
}
