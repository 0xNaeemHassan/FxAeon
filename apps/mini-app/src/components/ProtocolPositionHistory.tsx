'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import type { Address } from 'viem';
import { Card, SectionTitle } from '@/components/ui';
import TokenIcon from '@/components/TokenIcon';
import { haptic, openExternalLink } from '@/lib/telegram';
import { createWalletReadScope } from '@/lib/walletDataRefresh';
import { useRefreshAction } from '@/lib/useRefreshAction';
import {
  loadProtocolPositionHistory,
  type ProtocolHistoryCursor,
  type ProtocolPositionActivity,
} from '@/lib/protocolPositionHistory';

type Snapshot = {
  identity: string;
  items: ProtocolPositionActivity[];
  cursor: ProtocolHistoryCursor[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  partial: boolean;
  error: string;
};

const EMPTY_CURSOR = Array.from({ length: 4 }, () => ({ positions: 0, orders: 0 }));

function title(item: ProtocolPositionActivity): string {
  const position = `${item.market} ${item.side} #${item.positionId}`;
  if (item.kind === 'close') return `Closed ${position}`;
  if (item.kind === 'reduce') return `Reduced ${position}`;
  return `Opened or added ${position}`;
}

function activityDate(timestamp: number): string {
  return `${new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }).format(new Date(timestamp * 1000))} UTC`;
}

function txUrl(hash: string): string {
  return `https://etherscan.io/tx/${hash}`;
}

function mergeItems(previous: ProtocolPositionActivity[], next: ProtocolPositionActivity[]): ProtocolPositionActivity[] {
  const eventKey = (item: ProtocolPositionActivity) => `${item.chainId}:${item.hash.toLowerCase()}:${item.poolAddress.toLowerCase()}:${item.positionId}:${item.kind}`;
  const byTransaction = new Map(previous.map((item) => [eventKey(item), item]));
  for (const item of next) {
    const key = eventKey(item);
    if (!byTransaction.has(key)) byTransaction.set(key, item);
  }
  return [...byTransaction.values()].sort((left, right) => right.blockNumber === left.blockNumber
    ? right.timestamp - left.timestamp
    : left.blockNumber > right.blockNumber ? -1 : 1);
}

export default function ProtocolPositionHistory({ walletAddress, compact = false }: { walletAddress: Address; compact?: boolean }) {
  const identity = walletAddress.toLowerCase();
  const readScope = useRef(createWalletReadScope(walletAddress));
  readScope.current.select(walletAddress);
  const { run: runRefresh, refreshing: actionRefreshing } = useRefreshAction(identity);
  const [snapshot, setSnapshot] = useState<Snapshot>({
    identity: '', items: [], cursor: EMPTY_CURSOR, hasMore: false, loading: true,
    loadingMore: false, partial: false, error: '',
  });
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const current = snapshot.identity === identity;
  const items = useMemo(() => current ? snapshot.items : [], [current, snapshot.items]);
  const loading = !current || snapshot.loading;
  const loadingMore = current && snapshot.loadingMore;
  const partial = current && snapshot.partial;
  const error = current ? snapshot.error : '';
  const hasMore = current && snapshot.hasMore;

  const load = useCallback(async (append: boolean) => {
    const isCurrent = readScope.current.start(walletAddress);
    if (!isCurrent) return;
    setSnapshot((previous) => ({
      identity,
      items: previous.identity === identity ? previous.items : [],
      cursor: append && previous.identity === identity ? previous.cursor : EMPTY_CURSOR,
      hasMore: previous.identity === identity ? previous.hasMore : false,
      loading: !append,
      loadingMore: append,
      partial: false,
      error: '',
    }));
    const currentSnapshot = snapshotRef.current;
    const cursor = append && currentSnapshot.identity === identity ? currentSnapshot.cursor : undefined;
    try {
      const result = await loadProtocolPositionHistory({ walletAddress, ...(cursor ? { cursor } : {}) });
      if (!isCurrent()) return;
      setSnapshot((previous) => ({
        identity,
        items: (append || result.partial) && previous.identity === identity ? mergeItems(previous.items, result.items) : result.items,
        cursor: result.cursor,
        hasMore: result.hasMore,
        loading: false,
        loadingMore: false,
        partial: result.partial,
        error: '',
      }));
    } catch (cause) {
      if (!isCurrent()) return;
      setSnapshot((previous) => ({
        ...previous,
        identity,
        loading: false,
        loadingMore: false,
        error: cause instanceof Error ? cause.message : 'Protocol activity could not be loaded. Retry when network access is available.',
      }));
    }
  }, [identity, walletAddress]);

  const requestLoad = useCallback((append: boolean) => runRefresh([() => load(append)]), [load, runRefresh]);

  useEffect(() => {
    const scope = readScope.current;
    // This is an effect-owned request, not a user refresh action. A direct
    // start lets StrictMode's setup/cleanup replay supersede the first read
    // instead of joining its now-cancelled promise.
    void load(false);
    return () => scope.cancel();
  }, [load]);

  const visibleItems = useMemo(() => compact ? items.slice(0, 3) : items, [compact, items]);
  return (
    <section aria-labelledby={compact ? 'recent-protocol-activity-title' : 'protocol-position-history-title'}>
      <SectionTitle right={(
        <button
          type="button"
          aria-label="Refresh activity"
          className="glass-press flex min-h-11 min-w-11 items-center justify-center rounded-xl text-mut hover:text-mint"
          onClick={() => { haptic('light'); void requestLoad(false); }}
          disabled={actionRefreshing || loading || loadingMore}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading || loadingMore ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      )}>
        <span id={compact ? 'recent-protocol-activity-title' : 'protocol-position-history-title'}>
          {compact ? 'Recent history' : 'Position activity'}
        </span>
      </SectionTitle>
      <Card className="p-3.5">
        {loading && visibleItems.length === 0 ? (
          <div role="status" aria-label="Loading protocol position activity" className="space-y-2 py-1">
            <div className="skeleton h-12" /><div className="skeleton h-12" />
          </div>
        ) : (error || partial) && visibleItems.length === 0 ? (
          <div role="status" className="flex items-center justify-between gap-2 text-[10.5px] text-warn">
            <span>Refresh activity</span>
            <button type="button" onClick={() => void requestLoad(false)} className="glass-press flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg" aria-label="Refresh activity">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <>
            {loading && visibleItems.length > 0 && <span role="status" className="sr-only">Refreshing activity</span>}
            {(partial || error) && visibleItems.length > 0 && <button type="button" onClick={() => void requestLoad(false)} className="inline-flex min-h-11 items-center gap-2 text-[11px] font-semibold text-warn"><RefreshCw size={14} aria-hidden="true" />Refresh activity</button>}
            {visibleItems.length > 0 ? (
              <ul className="divide-y divide-[var(--line)]">
                {visibleItems.map((item) => (
                  <li key={`${item.chainId}:${item.hash.toLowerCase()}:${item.poolAddress.toLowerCase()}:${item.positionId}:${item.kind}`} className="flex min-h-14 items-center gap-3 py-2.5">
                    <TokenIcon symbol={item.market === 'ETH' ? 'ETH' : 'WBTC'} size={30} />
                    <span className="min-w-0 flex-1">
                      <strong className="block text-[12px] leading-snug">{title(item)}</strong>
                      <span className="mt-1 block text-[10.5px] text-mut">Ethereum · {activityDate(item.timestamp)}</span>
                    </span>
                    <a
                      href={txUrl(item.hash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(event) => {
                        event.preventDefault();
                        openExternalLink(txUrl(item.hash));
                      }}
                      className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-[10.5px] font-semibold text-mint hover:bg-[var(--mint-dim)]"
                    >
                      Receipt <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-1 py-2 text-[11.5px] leading-relaxed text-mut">No position activity yet.</p>
            )}
            <details className="mt-2 border-t border-[var(--line)] px-1 pt-1">
              <summary className="flex min-h-11 cursor-pointer items-center text-[10.5px] font-semibold text-mut">History details</summary>
              <p className="pb-2 text-[10px] leading-relaxed text-mut">Indexed position events are matched to successful Ethereum router receipts. Transfers out may not retain prior-wallet attribution in every market index. Other transaction types appear when saved in this browser.</p>
            </details>
            {hasMore && !compact && (
              <button
                type="button"
                className="mt-2 min-h-11 w-full rounded-lg px-3 text-[11px] font-semibold text-mint hover:bg-[var(--mint-dim)]"
                disabled={loadingMore}
                onClick={() => { haptic('light'); void requestLoad(true); }}
              >
                {loadingMore ? 'Loading earlier activity…' : 'Load earlier activity'}
              </button>
            )}
          </>
        )}
      </Card>
    </section>
  );
}
