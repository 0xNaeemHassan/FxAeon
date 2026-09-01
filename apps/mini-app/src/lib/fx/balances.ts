import type { Address } from "viem";
import { assertWalletAddress } from "./validation";
import { assertConfiguredPublicClientChain, getEthereumClient } from "./clients";
import { FX_TOKENS, type FxTokenKey } from "./tokens";
import type { FxPublicClient } from "./types";

const ERC20_BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

export interface WalletTokenBalance {
  key: FxTokenKey;
  address: Address;
  decimals: number;
  amountWei: bigint;
}

export interface WalletBalancesResult {
  /** Every successful supported-token read, including zero values. */
  balances: WalletTokenBalance[];
  /** A token can fail independently without hiding the other balances. */
  failedTokens: FxTokenKey[];
}

type BalanceClient = Pick<FxPublicClient, "getBalance" | "readContract">;

/**
 * Read the wallet's Ethereum balances using the same reviewed public client as
 * the official SDK. There is intentionally no USD conversion or price API:
 * the portfolio only reports exact token units that the chain returns.
 */
export async function readWalletBalances(walletAddress: string): Promise<WalletBalancesResult> {
  await assertConfiguredPublicClientChain(1);
  return readWalletBalancesFromClient(walletAddress, getEthereumClient());
}

/**
 * Same balance read with an injected public client. Keeping the chain/client
 * boundary separate makes the token accounting deterministic to test without
 * bypassing the production chain-identity check above.
 */
export async function readWalletBalancesFromClient(walletAddress: string, client: BalanceClient): Promise<WalletBalancesResult> {
  const address = assertWalletAddress(walletAddress);
  const keys = Object.keys(FX_TOKENS) as FxTokenKey[];
  const settled = await Promise.allSettled(keys.map(async (key) => {
    const definition = FX_TOKENS[key];
    const amountWei = definition.native
      ? await client.getBalance({ address })
      : await client.readContract({
        address: definition.address,
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [address],
      });
    return {
      key,
      address: definition.address,
      decimals: definition.decimals,
      amountWei,
    } satisfies WalletTokenBalance;
  }));

  const balances: WalletTokenBalance[] = [];
  const failedTokens: FxTokenKey[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") balances.push(result.value);
    else failedTokens.push(keys[index]);
  });

  // A completely failed read is a connection/configuration error, not a
  // legitimate empty wallet. Preserve that distinction for the UI.
  if (balances.length === 0) {
    const firstFailure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected")?.reason;
    throw firstFailure instanceof Error ? firstFailure : new Error("Wallet balances are unavailable.");
  }
  return { balances, failedTokens };
}
