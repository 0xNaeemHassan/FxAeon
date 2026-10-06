'use client';

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Address } from 'viem';
import { reconcileWalletJournal, type RecoveryViewModel } from './fx/recovery';
import { isRecoveryJournalStorageKey } from './fx/journal';
import { readSignatureRequiredDrafts } from './fx/drafts';
import { loadProtocolPositionHistory, type ProtocolPositionHistoryResult } from './protocolPositionHistory';
import {
  hasMoreWalletTransfers,
  loadWalletTransferHistory,
  nextWalletTransferCursors,
  type WalletTransferHistoryResult,
} from './walletTransferHistory';
import { activityCallKey, cachedActivityCallByKey, loadActivityCalls, uncachedActivityCalls, type ActivityCall } from './activityCalls';
import { activityCallRequests } from './walletActivity';
import { invalidateWalletQueries } from './web3/walletQueries';

export const activityQueryKey = (address: string) => ['wallet-activity', address.toLowerCase()] as const;
const policy = { staleTime: 60_000, gcTime: 300_000, retry: false, refetchOnWindowFocus: false } as const;
// Stable empty sources keep the merged feed memoized while a source is still loading.
const NO_VIEWS: RecoveryViewModel[] = [];
const NO_TRANSFERS: WalletTransferHistoryResult['items'] = [];
const NO_POSITION_TRANSFERS: WalletTransferHistoryResult['positionTransfers'] = [];

/** Keep rows from earlier pages when a newer first page or a later page arrives. */
function mergeTransferPages(latest: WalletTransferHistoryResult | undefined, next: WalletTransferHistoryResult): WalletTransferHistoryResult {
  const items = new Map((latest?.items ?? []).map((item) => [item.id, item]));
  for (const item of next.items) items.set(item.id, item);
  const positionTransfers = new Map((latest?.positionTransfers ?? []).map((item) => [item.id, item]));
  for (const item of next.positionTransfers ?? []) positionTransfers.set(item.id, item);
  return { ...next, items: [...items.values()], positionTransfers: [...positionTransfers.values()] };
}

/** One shared feed; independent sources settle without blocking already available rows. */
export function useWalletActivity(address: Address) {
  const client = useQueryClient();
  const key = activityQueryKey(address);
  const journal = useQuery({ ...policy, queryKey: [...key, 'journal'],
    queryFn: async () => {
      const old = client.getQueryData<RecoveryViewModel[]>([...activityQueryKey(address), 'journal']);
      const views = await reconcileWalletJournal({ walletAddress: address });
      const changedChains = new Set(views.filter((view) => view.verification === 'receipt'
        && old?.some((prior) => prior.record.id === view.record.id && prior.status === 'pending')).map((view) => view.record.chainId));
      for (const chainId of changedChains) void invalidateWalletQueries(client, address, chainId, { afterReceipt: true }).catch(() => undefined);
      return views.map((view) => view.verification === 'rpc-error'
        ? old?.find((item) => item.record.id === view.record.id && item.verification === 'receipt') ?? view : view);
    },
    refetchInterval: (query) => query.state.data?.some((view) => view.status === 'pending' && Date.now() - view.record.submittedAt < 3_600_000) ? 15_000 : false,
    refetchIntervalInBackground: false,
  });
  const protocol = useQuery({ ...policy, queryKey: [...key, 'protocol'],
    queryFn: async () => {
      const next = await loadProtocolPositionHistory({ walletAddress: address });
      const old = client.getQueryData<ProtocolPositionHistoryResult>([...activityQueryKey(address), 'protocol']);
      const items = new Map((old?.items ?? []).map((item) => [`${item.hash}:${item.poolAddress}:${item.positionId}:${item.kind}`, item]));
      for (const item of next.items) items.set(`${item.hash}:${item.poolAddress}:${item.positionId}:${item.kind}`, item);
      return { ...next, items: [...items.values()] };
    },
  });
  const transfers = useQuery({ ...policy, queryKey: [...key, 'transfers'],
    queryFn: async () => {
      const next = await loadWalletTransferHistory(address);
      return mergeTransferPages(client.getQueryData<WalletTransferHistoryResult>([...activityQueryKey(address), 'transfers']), next);
    },
  });

  // Rows without a journal record are explained from their calldata: one
  // batch per chain for hashes not cached yet. A failed read only leaves
  // those rows unclassified, so it never marks the feed partial.
  const callRequests = useMemo(() => activityCallRequests(journal.data ?? [], protocol.data?.items ?? [], transfers.data?.items ?? []),
    [journal.data, protocol.data, transfers.data]);
  const missingCalls = uncachedActivityCalls(callRequests);
  const calls = useQuery({ ...policy, queryKey: [...key, 'calls', missingCalls.map((request) => activityCallKey(request.chainId, request.hash)).join(',')],
    enabled: missingCalls.length > 0,
    queryFn: () => loadActivityCalls(missingCalls),
  });
  // The module cache is shared by every feed; its known keys give the map a stable identity.
  const cachedCallKeys = callRequests.map((request) => activityCallKey(request.chainId, request.hash))
    .filter((callKey) => cachedActivityCallByKey(callKey) !== undefined).join(',');
  const callMap = useMemo(() => Object.fromEntries(cachedCallKeys
    ? cachedCallKeys.split(',').map((callKey) => [callKey, cachedActivityCallByKey(callKey) ?? null])
    : []) as Record<string, ActivityCall | null>, [cachedCallKeys]);

  useEffect(() => {
    const invalidate = () => { void client.invalidateQueries({ queryKey: activityQueryKey(address) }); };
    const onStorage = (event: StorageEvent) => { if (isRecoveryJournalStorageKey(event.key)) invalidate(); };
    window.addEventListener('fxaeon:activity-updated', invalidate);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener('fxaeon:activity-updated', invalidate); window.removeEventListener('storage', onStorage); };
  }, [address, client]);
  const hasTransferPages = hasMoreWalletTransfers(transfers.data);
  const loadMore = async () => {
    const jobs: Promise<unknown>[] = [];
    if (protocol.data?.hasMore) jobs.push(loadProtocolPositionHistory({ walletAddress: address, cursor: protocol.data.cursor }).then((next) => {
      client.setQueryData<ProtocolPositionHistoryResult>([...key, 'protocol'], (latest) => {
        const items = new Map((latest?.items ?? []).map((item) => [`${item.hash}:${item.poolAddress}:${item.positionId}:${item.kind}`, item]));
        for (const item of next.items) items.set(`${item.hash}:${item.poolAddress}:${item.positionId}:${item.kind}`, item);
        return { ...next, items: [...items.values()] };
      });
    }));
    if (hasTransferPages && transfers.data) {
      jobs.push(loadWalletTransferHistory(address, nextWalletTransferCursors(transfers.data)).then((next) => {
        client.setQueryData<WalletTransferHistoryResult>([...key, 'transfers'], (latest) => mergeTransferPages(latest, next));
      }));
    }
    await Promise.allSettled(jobs);
  };
  return {
    data: { views: journal.data ?? NO_VIEWS, protocol: protocol.data, transfers: transfers.data?.items ?? NO_TRANSFERS,
      positionTransfers: transfers.data?.positionTransfers ?? NO_POSITION_TRANSFERS, calls: callMap,
      drafts: readSignatureRequiredDrafts(address).filter((draft) => draft.status === 'signature-required'),
      // A source is partial only when a read failed. An indexed event that did not
      // verify as this wallet's is filtered on purpose and is no reason to warn.
      partial: journal.isError || protocol.isError || transfers.isError || Boolean(protocol.data?.incomplete || transfers.data?.partial)
        || Boolean(journal.data?.some((view) => view.verification === 'rpc-error')) },
    isPending: journal.isPending && protocol.isPending && transfers.isPending,
    isFetching: journal.isFetching || protocol.isFetching || transfers.isFetching,
    hasMore: Boolean(protocol.data?.hasMore || hasTransferPages), loadMore,
    refetch: () => Promise.allSettled([journal.refetch(), protocol.refetch(), transfers.refetch(), ...(missingCalls.length ? [calls.refetch()] : [])]),
  };
}
