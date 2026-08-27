import {
  createPublicClient,
  http,
} from "viem";
import { base, mainnet } from "viem/chains";
import { BASE_CHAIN_ID, ETHEREUM_CHAIN_ID, requireRpcUrl } from "./config";
import type { FxChainId } from "./types";
import type { FxPublicClient } from "./types";

let ethereumClient: FxPublicClient | undefined;
let baseClient: FxPublicClient | undefined;

/**
 * Prove the remote endpoint's chain identity with eth_chainId. A viem `chain`
 * object is request metadata, not evidence about the server behind an RPC URL.
 * Call this at financial planning, signing, and recovery boundaries.
 */
export async function assertPublicClientChain(
  client: Pick<FxPublicClient, "getChainId"> & { chain?: { id?: number } },
  expectedChainId: FxChainId,
): Promise<void> {
  if (typeof client.getChainId !== "function") {
    throw new Error(`RPC client cannot prove chain identity; expected ${expectedChainId}`);
  }
  const remoteChainId = await client.getChainId();
  if (!Number.isSafeInteger(remoteChainId) || remoteChainId !== expectedChainId) {
    throw new Error(`RPC endpoint returned chain ${String(remoteChainId)}; expected ${expectedChainId}`);
  }
  if (client.chain?.id !== undefined && client.chain.id !== expectedChainId) {
    throw new Error(`public client metadata is for chain ${client.chain.id}; expected ${expectedChainId}`);
  }
}

/** Probe the exact request-local URL used by the SDK bridge methods. */
export async function assertRpcUrlChain(
  rpcUrl: string,
  expectedChainId: FxChainId,
): Promise<void> {
  const chain = expectedChainId === ETHEREUM_CHAIN_ID ? mainnet : base;
  const probe = createPublicClient({ chain, transport: http(rpcUrl) }) as unknown as FxPublicClient;
  await assertPublicClientChain(probe, expectedChainId);
}

export async function assertConfiguredPublicClientChain(chainId: FxChainId): Promise<void> {
  await assertPublicClientChain(getPublicClient(chainId), chainId);
}

/** One read client per supported chain; no browser signer is stored here. */
export function getPublicClient(chainId: FxChainId): FxPublicClient {
  if (chainId === ETHEREUM_CHAIN_ID) {
    if (!ethereumClient) {
      const rpcUrl = requireRpcUrl(ETHEREUM_CHAIN_ID);
      ethereumClient = createPublicClient({
        chain: mainnet,
        transport: http(rpcUrl),
      }) as unknown as FxPublicClient;
    }
    return ethereumClient;
  }

  if (!baseClient) {
    const rpcUrl = requireRpcUrl(BASE_CHAIN_ID);
    baseClient = createPublicClient({
      chain: base,
      transport: http(rpcUrl),
    }) as unknown as FxPublicClient;
  }
  return baseClient;
}

export function getEthereumClient(): FxPublicClient {
  return getPublicClient(ETHEREUM_CHAIN_ID);
}

export function getBaseClient(): FxPublicClient {
  return getPublicClient(BASE_CHAIN_ID);
}

/**
 * Test-only reset. It intentionally lives in this module rather than exposing
 * mutable client state to product code. Never call it from the Mini App.
 */
export function resetPublicClientForTests(): void {
  ethereumClient = undefined;
  baseClient = undefined;
}
