'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { WagmiProvider, useConfig, useWatchBlockNumber } from 'wagmi';
import { usePrivyWallet } from '@/lib/wallet';
import { createWalletDataConfig, type WalletDataConfig } from '@/lib/web3/config';
import {
  createWalletQueryClient, invalidateWalletQueries, moveBalanceQueryOptions, walletBalanceQueryOptions, WALLET_QUERY_ROOT,
} from '@/lib/web3/walletQueries';
import type { WalletBalancesResult } from '@/lib/fx/balances';
import type { CanonicalMoveBalanceMap } from '@/lib/moveBalances';

const WalletDataSession = createContext('disconnected');

export default function WalletDataProvider({ children }: { children: React.ReactNode }) {
  const wallet = usePrivyWallet();
  const [config] = useState(createWalletDataConfig);
  const [queryClient] = useState(createWalletQueryClient);
  const session = wallet.ready && wallet.authenticated && wallet.address
    ? `${wallet.address.toLowerCase()}:${wallet.chainId ?? 'unknown'}` : 'disconnected';

  useEffect(() => {
    // Cancel old-session queries, including their late RPC results, without
    // remounting the page or resetting a user's form inputs.
    const filters = { predicate: ({ queryKey }: { queryKey: readonly unknown[] }) =>
      queryKey[0] === WALLET_QUERY_ROOT && queryKey[1] !== session };
    void queryClient.cancelQueries(filters);
    queryClient.removeQueries(filters);
  }, [queryClient, session]);
  useEffect(() => {
    // TanStack's visibility/online subscriptions handle tab/app resume. Also
    // cover wallet-extension popups returning focus to the same visible tab.
    const onFocus = () => {
      if (document.visibilityState === 'visible') void queryClient.refetchQueries({ type: 'active', stale: true }, { cancelRefetch: false });
    };
    window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener('focus', onFocus); };
  }, [queryClient]);

  return <WagmiProvider config={config} reconnectOnMount={false}>
    <QueryClientProvider client={queryClient}>
      <WalletDataSession.Provider value={session}>
        <BalanceBlockWatcher chainId={1} />
        <BalanceBlockWatcher chainId={8453} />
        {children}
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
  return useCallback((address: string, chainId: number) => invalidateWalletQueries(client, address, chainId), [client]);
}

/** One block watcher per actively displayed chain, never one per token/card. */
function BalanceBlockWatcher({ chainId }: { chainId: 1 | 8453 }) {
  const config = useConfig<WalletDataConfig>();
  const client = useQueryClient();
  const session = useContext(WalletDataSession);
  const [watching, setWatching] = useState(false);
  useEffect(() => {
    const update = () => {
      const active = session !== 'disconnected' && document.visibilityState === 'visible'
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
    update();
    return () => { unsubscribe(); document.removeEventListener('visibilitychange', update); };
  }, [chainId, client, config, session]);
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
