'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Address } from 'viem';
import { reconcileWalletJournal, type RecoveryViewModel } from './fx/recovery';
import { isRecoveryJournalStorageKey } from './fx/journal';
import { readSignatureRequiredDrafts } from './fx/drafts';
import { loadProtocolPositionHistory, type ProtocolPositionHistoryResult } from './protocolPositionHistory';
import { loadWalletTransferHistory, type WalletTransferHistoryResult, type WalletTransferCursorMap } from './walletTransferHistory';
import { invalidateWalletQueries } from './web3/walletQueries';

export const activityQueryKey = (address: string) => ['wallet-activity', address.toLowerCase()] as const;
const policy = { staleTime: 60_000, gcTime: 300_000, retry: false, refetchOnWindowFocus: false } as const;

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
      const old = client.getQueryData<WalletTransferHistoryResult>([...activityQueryKey(address), 'transfers']);
      const items = new Map((old?.items ?? []).map((item) => [item.id, item]));
      for (const item of next.items) items.set(item.id, item);
      return { ...next, items: [...items.values()] };
    },
  });
  useEffect(() => {
    const invalidate = () => { void client.invalidateQueries({ queryKey: activityQueryKey(address) }); };
    const onStorage = (event: StorageEvent) => { if (isRecoveryJournalStorageKey(event.key)) invalidate(); };
    window.addEventListener('fxaeon:activity-updated', invalidate);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener('fxaeon:activity-updated', invalidate); window.removeEventListener('storage', onStorage); };
  }, [address, client]);
  const hasTransferPages = Object.values(transfers.data?.cursors ?? {}).some((chain) => Object.values(chain).some(Boolean));
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
      const cursors: WalletTransferCursorMap = {};
      for (const chainId of [1, 8453] as const) for (const direction of ['sent', 'received'] as const) {
        const cursor = transfers.data.cursors[chainId][direction];
        if (cursor) { cursors[chainId] ??= {}; cursors[chainId]![direction] = cursor; }
      }
      jobs.push(loadWalletTransferHistory(address, cursors).then((next) => {
        client.setQueryData<WalletTransferHistoryResult>([...key, 'transfers'], (latest) => {
          const items = new Map((latest?.items ?? []).map((item) => [item.id, item]));
          for (const item of next.items) items.set(item.id, item);
          return { ...next, items: [...items.values()] };
        });
      }));
    }
    await Promise.allSettled(jobs);
  };
  return {
    data: { views: journal.data ?? [], protocol: protocol.data, transfers: transfers.data?.items ?? [],
      drafts: readSignatureRequiredDrafts(address).filter((draft) => draft.status === 'signature-required'),
      partial: journal.isError || protocol.isError || transfers.isError || Boolean(protocol.data?.partial || transfers.data?.partial)
        || Boolean(journal.data?.some((view) => view.verification === 'rpc-error')) },
    isPending: journal.isPending && protocol.isPending && transfers.isPending,
    isFetching: journal.isFetching || protocol.isFetching || transfers.isFetching,
    hasMore: Boolean(protocol.data?.hasMore || hasTransferPages), loadMore,
    refetch: () => Promise.allSettled([journal.refetch(), protocol.refetch(), transfers.refetch()]),
  };
}
