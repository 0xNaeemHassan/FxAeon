import { createConfig } from 'wagmi';
import type { Client, Transport } from 'viem';
import { base, mainnet } from 'viem/chains';
import { getPublicClient } from '../fx/clients';
import type { FxChainId } from '../fx/types';

/**
 * Wagmi owns public data, not signing authority. Reuse the reviewed RPC clients
 * (including the explicit local-fork test boundary); never fall back to a
 * chain's default RPC or discover/connect another wallet behind Privy's back.
 */
export function createWalletDataConfig(
  clientForChain: (chainId: FxChainId) => Client = (chainId) => getPublicClient(chainId) as unknown as Client,
) {
  return createConfig({
    chains: [mainnet, base],
    connectors: [],
    multiInjectedProviderDiscovery: false,
    syncConnectedChain: false,
    storage: null,
    // The config has no connector, storage, or initial connection state to
    // hydrate. Wagmi 3's SSR hydrator assumes a persistent store, which is
    // deliberately absent here; its deterministic default is safe for this
    // read-only static provider and avoids a rehydrate call on `null` storage.
    ssr: false,
    client({ chain }) {
      return clientForChain(chain.id) as Client<Transport, typeof chain>;
    },
  });
}

export type WalletDataConfig = ReturnType<typeof createWalletDataConfig>;
