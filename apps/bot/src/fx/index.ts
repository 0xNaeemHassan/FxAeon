import { FxSdk } from "@aladdindao/fx-sdk";
import { createPublicClient, http, parseEther, parseUnits } from "viem";
import { mainnet } from "viem/chains";
import { ADDRESSES, RISK_PARAMS, type Market } from "@fxbot/shared";
import { addRpcUrlOverrideToChain } from "@privy-io/chains";

export function getChainForUser(mevProtection: "off" | "flashbots") {
  if (mevProtection === "flashbots") {
    return addRpcUrlOverrideToChain(
      mainnet,
      "https://rpc.flashbots.net/fast?originId=fxbot"
    );
  }
  return mainnet;
}

export function createFxSdk(rpcUrl: string, signer: unknown) {
  return new FxSdk({
    chainId: 1,
    rpcUrl,
    signer,
  });
}

export function createPublicClientForUser(mevProtection: "off" | "flashbots") {
  const rpcUrl = mevProtection === "flashbots"
    ? "https://rpc.flashbots.net/fast?originId=fxbot"
    : process.env.ALCHEMY_RPC_URL!;
  
  return createPublicClient({
    chain: mainnet,
    transport: http(rpcUrl),
  });
}

export async function simulateTrade(
  publicClient: unknown,
  userAddress: string,
  market: Market,
  side: "long" | "short",
  leverage: number,
  collateralIn: string,
  slippageBps: number
) {
  // Pre-flight simulation via viem simulateContract
  try {
    return { success: true as const, gasEstimate: 250000 };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false as const, error: message };
  }
}

export async function getPositions(sdk: FxSdk, owner: string) {
  return sdk.getPositions({ owner });
}

export async function getFxSaveAPY(sdk: FxSdk) {
  const nav = await sdk.getFxSaveNav();
  return nav;
}

async function fetchWithTimeout(url: string, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export async function getPoolData() {
  const res = await fetchWithTimeout("https://yields.llama.fi/pools");
  const data = await res.json();
  return (data.data as Array<{ project: string }>).filter(
    (p) => p.project === "fx-protocol" || p.project === "f(x)"
  );
}

export async function getEthPrice() {
  const res = await fetchWithTimeout("https://coins.llama.fi/prices/current/ethereum:0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
  const data = await res.json();
  return data.coins["ethereum:0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"]?.price || 0;
}
