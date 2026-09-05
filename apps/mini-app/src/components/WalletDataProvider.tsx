'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { WagmiProvider, useConfig, useWatchBlockNumber } from 'wagmi';
import { usePrivyWallet } from '@/lib/wallet';
import { createWalletDataConfig, type WalletDataConfig } from '@/lib/web3/config';
import {
  canonicalWalletAssetQueryOptions, createWalletQueryClient, invalidateWalletQueries, moveBalanceQueryOptions, walletBalanceQueryOptions, WALLET_QUERY_ROOT,
} from '@/lib/web3/walletQueries';
import type { WalletBalancesResult } from '@/lib/fx/balances';
import type { CanonicalMoveBalanceMap } from '@/lib/moveBalances';
import {
  alchemyDataApiKey, fetchAlchemyWalletAssets, mergeCanonicalWalletAssets,
  type CanonicalAssetRead, type WalletAssetSnapshot,
} from '@/lib/walletAssets';
import { useUsdPrices } from '@/components/PriceProvider';
import { createAlchemyChainPulse, initialRealtimeChainState, type RealtimeChainEvent, type RealtimeChainState } from '@/lib/realtimeChain';
import type { FxChainId } from '@/lib/fx/types';
import { subscribeToForegroundResume } from '@/lib/foreground';

const WalletDataSession = createContext('disconnected');

type WalletAssetsHookResult = {
  data: WalletAssetSnapshot | null;
  status: 'idle' | 'loading' | 'ready' | 'partial' | 'unavailable';
  isFetching: boolean;
  error: string;
  refresh: () => Promise<WalletAssetSnapshot | undefined>;
};

const EMPTY_CHAIN_STATE: Record<FxChainId, RealtimeChainState> = {
  1: initialRealtimeChainState(1),
  8453: initialRealtimeChainState(8453),
};
const WalletAssetsContext = createContext<WalletAssetsHookResult>({
  data: null, status: 'idle', isFetching: false, error: '', refresh: async () => undefined,
});
const RealtimeChainContext = createContext<Record<FxChainId, RealtimeChainState>>(EMPTY_CHAIN_STATE);

export type WalletPulse = {
  assets: WalletAssetsHookResult;
  chains: Record<FxChainId, RealtimeChainState>;
};

export default function WalletDataProvider({ children, enabled = true }: { children: React.ReactNode; enabled?: boolean }) {
  const wallet = usePrivyWallet();
  const [config] = useState(createWalletDataConfig);
  const [queryClient] = useState(createWalletQueryClient);
  const session = wallet.ready && wallet.authenticated && wallet.address
    ? `${wallet.address.toLowerCase()}:${wallet.chainId ?? 'unknown'}` : 'disconnected';

  useEffect(() => {
    // Cancel old-session queries, including their late RPC results, without
    // remounting the page or resetting a user's form inputs.
    const filters = { predicate: ({ queryKey }: { queryKey: readonly unknown[] }) =>
      queryKey[0] === WALLET_QUERY_ROOT && (queryKey[1] === 'assets'
        ? session === 'disconnected' || queryKey[2] !== session.split(':')[0]
        : queryKey[1] !== session) };
    void queryClient.cancelQueries(filters);
    queryClient.removeQueries(filters);
  }, [queryClient, session]);
  useEffect(() => {
    // TanStack's visibility/online subscriptions handle tab/app resume. Also
    // cover wallet-extension popups returning focus to the same visible tab.
    return subscribeToForegroundResume(() => { if (enabled) void queryClient.refetchQueries({ type: 'active', stale: true }, { cancelRefetch: false }); });
  }, [enabled, queryClient]);

  return <WagmiProvider config={config} reconnectOnMount={false}>
    <QueryClientProvider client={queryClient}>
      <WalletDataSession.Provider value={session}>
        <WalletAssetLayer address={wallet.address} enabled={enabled && wallet.ready && wallet.authenticated}>{children}</WalletAssetLayer>
      </WalletDataSession.Provider>
    </QueryClientProvider>
  </WagmiProvider>;
}

export function useWalletBalances({ address, chainId = 1, enabled = true }: {
  address?: string; chainId?: number; enabled?: boolean;
}): {
  data: WalletBalancesResult | null;
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
  isFetching: boolean;
  error: string;
  refresh: () => Promise<WalletBalancesResult | undefined>;
} {
  const config = useConfig<WalletDataConfig>();
  const queryClient = useQueryClient();
  const session = useContext(WalletDataSession);
  const latestSession = useRef(session);
  latestSession.current = session;
  const active = enabled && Boolean(address) && session !== 'disconnected'
    && session.split(':')[0] === address?.toLowerCase();
  const supported = chainId === 1;
  const options = walletBalanceQueryOptions(config, session, address ?? '', chainId);
  const query = useQuery({ ...options, enabled: active && supported, refetchInterval: 60_000 });
  const refresh = useCallback(async () => {
    if (!active || !supported || !address || latestSession.current !== session) return;
    await invalidateWalletQueries(queryClient, address, chainId);
    // Invalidation already refetched this active observer. Never recreate an
    // old session's query if the wallet changed while that read was pending.
    if (latestSession.current !== session) return;
    const key = walletBalanceQueryOptions(config, session, address, chainId).queryKey;
    if (queryClient.getQueryState(key)?.status !== 'success') return;
    return queryClient.getQueryData(key);
  }, [active, address, chainId, config, queryClient, session, supported]);
  const status = !active ? 'idle' : !supported || query.isError ? 'unavailable'
    : query.data ? 'ready' : 'loading';
  return useMemo(() => ({
    data: status === 'ready' ? query.data ?? null : null,
    status,
    isFetching: active && query.isFetching,
    error: status === 'unavailable' ? 'Wallet balances are temporarily unavailable.' : '',
    refresh,
  }), [active, query.data, query.isFetching, refresh, status]);
}

export function useInvalidateWalletData() {
  const client = useQueryClient();
  return useCallback(async (address: string, chainId: number) => {
    await invalidateWalletQueries(client, address, chainId);
    await client.invalidateQueries({ queryKey: walletAssetsQueryKey(address), refetchType: 'active' });
  }, [client]);
}

export function walletAssetsQueryKey(address: string) {
  return [WALLET_QUERY_ROOT, 'assets', address.toLowerCase()] as const;
}

export function useWalletAssets({ address, enabled = true }: { address?: string; enabled?: boolean } = {}): WalletAssetsHookResult {
  const session = useContext(WalletDataSession);
  const result = useContext(WalletAssetsContext);
  if (!enabled || !address || session === 'disconnected' || session.split(':')[0] !== address.toLowerCase()) {
    return { data: null, status: 'idle', isFetching: false, error: '', refresh: async () => undefined };
  }
  return result;
}

export function useRealtimeChainState(chainId?: FxChainId): Record<FxChainId, RealtimeChainState> | RealtimeChainState {
  const state = useContext(RealtimeChainContext);
  return chainId ? state[chainId] : state;
}

export function useWalletPulse({ address, enabled = true }: { address?: string; enabled?: boolean } = {}): WalletPulse {
  return { assets: useWalletAssets({ address, enabled }), chains: useContext(RealtimeChainContext) };
}

function WalletAssetLayer({ address, enabled, children }: { address?: string; enabled: boolean; children: React.ReactNode }) {
  const config = useConfig<WalletDataConfig>();
  const client = useQueryClient();
  const session = useContext(WalletDataSession);
  const { prices, status: priceStatus, updatedAt: priceUpdatedAt } = useUsdPrices();
  const priceRef = useRef({ prices, status: priceStatus, updatedAt: priceUpdatedAt });
  priceRef.current = { prices, status: priceStatus, updatedAt: priceUpdatedAt };
  const active = enabled && Boolean(address) && session !== 'disconnected' && session.split(':')[0] === address?.toLowerCase();
  const [chainStates, setChainStates] = useState<Record<FxChainId, RealtimeChainState>>(EMPTY_CHAIN_STATE);
  const requestRef = useRef<{ controller: AbortController; promise: Promise<WalletAssetSnapshot | undefined> } | null>(null);
  const latestSession = useRef(session);
  latestSession.current = session;

  const networkLive = chainStates[1].status === 'live' && chainStates[8453].status === 'live';
  const fallbackInterval = networkLive ? false : 30_000;
  const indexed = useQuery({
    queryKey: address ? [WALLET_QUERY_ROOT, 'assets', address.toLowerCase()] as const : [WALLET_QUERY_ROOT, 'assets', 'disconnected'] as const,
    queryFn: ({ signal }) => fetchAlchemyWalletAssets(address ?? '', signal),
    enabled: active && Boolean(alchemyDataApiKey()),
    // Discovery is event-driven; bounded polling is reserved for exact reads.
    refetchInterval: false,
  });
  const ethereum = useQuery({ ...canonicalWalletAssetQueryOptions(config, session, address ?? '', 1), enabled: active, refetchInterval: fallbackInterval });
  const base = useQuery({ ...canonicalWalletAssetQueryOptions(config, session, address ?? '', 8453), enabled: active, refetchInterval: fallbackInterval });

  const failedRead = useCallback((chainId: FxChainId, query: { data?: CanonicalAssetRead; isError: boolean; isPending: boolean }): CanonicalAssetRead | null => {
    if (query.data) return query.data;
    if (query.isPending || !query.isError) return null;
    const failedTokens = chainId === 1
      ? ['ETH', 'WETH', 'wstETH', 'stETH', 'WBTC', 'USDC', 'USDT', 'fxUSD', 'fxUSDBasePool', 'fxSAVE', 'FXN'] as const
      : ['ETH', 'fxUSD', 'fxSAVE'] as const;
    return { chainId, balances: [], failedTokens: [...failedTokens], updatedAt: Date.now() };
  }, []);
  const canonicalReads = useMemo(() => [
    ethereum.isFetching ? { chainId: 1 as const, balances: [], failedTokens: [], updatedAt: Date.now(), status: 'pending' as const } : failedRead(1, ethereum),
    base.isFetching ? { chainId: 8453 as const, balances: [], failedTokens: [], updatedAt: Date.now(), status: 'pending' as const } : failedRead(8453, base),
  ].filter((read): read is CanonicalAssetRead => Boolean(read)), [base, ethereum, failedRead]);
  const merged = useMemo(() => {
    if (!active || !address) return null;
    // Keep the asset surface in its loading state until the first indexed or
    // canonical response arrives. A pending read is not a failed balance.
    if (!indexed.data && canonicalReads.length === 0) return null;
    const source = indexed.data ?? null;
    return mergeCanonicalWalletAssets(source, address, canonicalReads, { prices, status: priceStatus, updatedAt: priceUpdatedAt });
  }, [active, address, canonicalReads, indexed.data, priceStatus, priceUpdatedAt, prices]);

  const refresh = useCallback((): Promise<WalletAssetSnapshot | undefined> => {
    if (!active || !address || latestSession.current !== session) return Promise.resolve(undefined);
    if (requestRef.current) return requestRef.current.promise;
    const controller = new AbortController();
    const promise = (async () => {
      const tasks: Promise<unknown>[] = [
        client.invalidateQueries({ queryKey: walletAssetsQueryKey(address), refetchType: 'active' }, { cancelRefetch: false }),
        invalidateWalletQueries(client, address, 1), invalidateWalletQueries(client, address, 8453),
      ];
      await Promise.all(tasks);
      if (controller.signal.aborted || latestSession.current !== session) return undefined;
      const nextIndexed = client.getQueryData<WalletAssetSnapshot>(walletAssetsQueryKey(address)) ?? null;
      const nextCanonical = [
        client.getQueryData<CanonicalAssetRead>(canonicalWalletAssetQueryOptions(config, session, address, 1).queryKey),
        client.getQueryData<CanonicalAssetRead>(canonicalWalletAssetQueryOptions(config, session, address, 8453).queryKey),
      ].filter((read): read is CanonicalAssetRead => Boolean(read));
      return mergeCanonicalWalletAssets(nextIndexed, address, nextCanonical, priceRef.current);
    })().finally(() => {
      if (requestRef.current?.controller === controller) requestRef.current = null;
    });
    requestRef.current = { controller, promise };
    return promise;
  }, [active, address, client, config, session]);

  const triggerRefresh = useCallback((_event?: RealtimeChainEvent) => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!active || !address) {
      setChainStates(EMPTY_CHAIN_STATE);
      return;
    }
    const controllers: Partial<Record<FxChainId, ReturnType<typeof createAlchemyChainPulse>>> = {};
    let disposed = false;
    const update = () => {
      const foreground = document.visibilityState === 'visible' && navigator.onLine;
      for (const chainId of [1, 8453] as const) controllers[chainId]?.setActive(foreground);
    };
    for (const chainId of [1, 8453] as const) {
      try {
        const controller = createAlchemyChainPulse({
          chainId, walletAddress: address,
          onState: (next) => { if (!disposed) setChainStates((current) => ({ ...current, [chainId]: next })); },
          onEvent: (event) => {
            if (disposed) return;
            if (event.kind === 'block') void invalidateWalletQueries(client, address, chainId);
            else triggerRefresh(event);
          },
        });
        controllers[chainId] = controller;
      } catch {
        setChainStates((current) => ({ ...current, [chainId]: { ...current[chainId], status: 'unavailable' } }));
      }
    }
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      Object.values(controllers).forEach((controller) => controller?.stop());
    };
  }, [active, address, client, refresh, triggerRefresh]);
  useEffect(() => () => requestRef.current?.controller.abort(), []);

  const status: WalletAssetsHookResult['status'] = !active ? 'idle'
    : merged ? Object.values(merged.networks).some((network) => network.status === 'pending') ? 'loading'
      : Object.values(merged.networks).some((network) => network.status === 'unavailable') ? 'unavailable'
        : Object.values(merged.networks).some((network) => network.status === 'partial') ? 'partial' : 'ready'
      : indexed.isError && ethereum.isError && base.isError ? 'unavailable' : 'loading';
  const error = status === 'unavailable' ? 'Wallet assets are temporarily unavailable.' : status === 'partial' ? 'Some wallet assets are temporarily unavailable.' : '';
  const value = useMemo<WalletAssetsHookResult>(() => ({ data: merged, status, isFetching: indexed.isFetching || ethereum.isFetching || base.isFetching, error, refresh }), [base.isFetching, error, ethereum.isFetching, indexed.isFetching, merged, refresh, status]);
  return <WalletAssetsContext.Provider value={value}><RealtimeChainContext.Provider value={chainStates}><BalanceBlockWatcher chainId={1} /><BalanceBlockWatcher chainId={8453} />{children}</RealtimeChainContext.Provider></WalletAssetsContext.Provider>;
}

/** One block watcher per actively displayed chain, never one per token/card. */
function BalanceBlockWatcher({ chainId }: { chainId: 1 | 8453 }) {
  const config = useConfig<WalletDataConfig>();
  const client = useQueryClient();
  const session = useContext(WalletDataSession);
  const realtime = useContext(RealtimeChainContext)[chainId];
  const [watching, setWatching] = useState(false);
  useEffect(() => {
    const update = () => {
      const active = realtime.status !== 'live' && session !== 'disconnected' && document.visibilityState === 'visible' && navigator.onLine
        && client.getQueryCache().findAll({ predicate: ({ queryKey }) =>
          queryKey[0] === WALLET_QUERY_ROOT && queryKey[1] === session && queryKey[2] === chainId,
        }).some((query) => query.isActive());
      // A public/no-RPC build must show the normal unavailable state, not
      // throw while installing a watcher from a React effect.
      try { if (active) config.getClient({ chainId }); setWatching(active); }
      catch { setWatching(false); }
    };
    const unsubscribe = client.getQueryCache().subscribe(update);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
    return () => { unsubscribe(); document.removeEventListener('visibilitychange', update); window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, [chainId, client, config, realtime.status, session]);
  useWatchBlockNumber({
    config, chainId, enabled: watching, poll: true, pollingInterval: 12_000, emitOnBegin: false,
    onBlockNumber: (_block, previous) => {
      if (previous === undefined) return;
      void client.invalidateQueries({ predicate: ({ queryKey }) => queryKey[0] === WALLET_QUERY_ROOT
        && queryKey[1] === session && queryKey[2] === chainId, refetchType: 'active',
      }, { cancelRefetch: false });
    },
    onError: () => { /* Queries retain their own error/retry/fallback refresh state. */ },
  });
  return null;
}

export function useMoveBalances({ address, chainId, enabled = true }: { address?: string; chainId: number; enabled?: boolean }): {
  data: { balances: CanonicalMoveBalanceMap; status: 'ready' | 'unavailable' } | null;
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
  isFetching: boolean;
  refresh: () => Promise<void>;
} {
  const config = useConfig<WalletDataConfig>();
  const client = useQueryClient();
  const session = useContext(WalletDataSession);
  const latestSession = useRef(session);
  latestSession.current = session;
  const active = enabled && Boolean(address) && session !== 'disconnected'
    && session.split(':')[0] === address?.toLowerCase();
  const supported = chainId === 1 || chainId === 8453;
  const query = useQuery({ ...moveBalanceQueryOptions(config, session, address ?? '', chainId),
    enabled: active && supported, refetchInterval: 60_000 });
  const refresh = useCallback(async () => {
    if (!active || !supported || !address || latestSession.current !== session) return;
    await invalidateWalletQueries(client, address, chainId);
  }, [active, address, chainId, client, session, supported]);
  const status = !active ? 'idle' : !supported || query.isError ? 'unavailable'
    : query.data?.status ?? 'loading';
  return { data: active && supported && !query.isError ? query.data ?? null : null,
    status, isFetching: active && query.isFetching, refresh };
}
