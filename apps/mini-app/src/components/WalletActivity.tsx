'use client';

import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ArrowDown, ArrowUpRight, Check, ChevronRight, Clock3, ExternalLink, RefreshCw, Search, X } from 'lucide-react';
import { formatEther, formatUnits, type Address, type Hex } from 'viem';
import { useQuery } from '@tanstack/react-query';
import TokenIcon, { ChainIcon } from './TokenIcon';
import { SectionTitle } from './ui';
import { BridgeTracker } from './BridgeTracker';
import { useWalletActivity } from '@/lib/useWalletActivity';
import { mergeWalletActivity, operationTitle, type WalletActivity as Activity } from '@/lib/walletActivity';
import { cancelSignatureRequiredDraft, signatureDraftResumePath } from '@/lib/fx/drafts';
import { buildReceiptPresentation } from '@/lib/receiptPresentation';
import { useOverlayDialog } from '@/lib/useOverlayDialog';
import { useExitPresence } from '@/lib/useExitPresence';
import { compactAddress } from '@/lib/addressPresentation';
import { openExternalLink } from '@/lib/telegram';
import { WalletAvatar } from './WalletAvatar';
import { loadActivityReceipt } from '@/lib/activityReceipt';
import styles from './WalletActivity.module.css';

export default function WalletActivity({ walletAddress, compact = false, inDialog = false }: { walletAddress: Address; compact?: boolean; inDialog?: boolean }) {
  // A new account owns a new selection/filter state as well as a separate query cache.
  return <ActivityFeed key={walletAddress.toLowerCase()} walletAddress={walletAddress} compact={compact || inDialog} inDialog={inDialog} />;
}

function ActivityFeed({ walletAddress, compact, inDialog }: { walletAddress: Address; compact: boolean; inDialog: boolean }) {
  const activity = useWalletActivity(walletAddress);
  const [search, setSearch] = useState('');
  const [chain, setChain] = useState('all');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<Activity | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rows = useMemo(() => mergeWalletActivity(activity.data.views, activity.data.protocol?.items ?? [], activity.data.transfers, walletAddress), [activity.data, walletAddress]);
  const filtered = rows.filter((item) => (chain === 'all' || String(item.chainId) === chain)
    && (filter === 'all' || item.status === filter)
    && `${item.title} ${item.hash} ${item.symbol}`.toLowerCase().includes(search.toLowerCase()));
  const visible = compact ? filtered.slice(0, 3) : filtered;
  const drafts = activity.data?.drafts ?? [];
  const unavailable = !activity.isPending && rows.length === 0 && activity.data.partial;
  // A verified-empty preview stays hidden; an unreadable one says so instead of looking empty.
  // The wallet dialog keeps its own History row, so it only previews rows that exist.
  if (compact && !activity.isPending && rows.length === 0 && (!unavailable || inDialog)) return null;
  return <section className={styles.section} aria-label={compact ? 'Recent history' : 'Transaction history'}>
    <SectionTitle level={inDialog ? 3 : 2} right={<div className={styles.toolbar}>
      {compact && !inDialog && <Link href="/history" aria-label="View all history">View all<ChevronRight size={14} aria-hidden="true" /></Link>}
      <button type="button" aria-label="Refresh history" title="Refresh history" disabled={activity.isFetching} onClick={() => void activity.refetch()}>
        <RefreshCw size={16} className={activity.isFetching ? 'animate-spin' : ''} aria-hidden="true" />
      </button>
    </div>}>{compact ? 'History' : <span className="sr-only">History</span>}</SectionTitle>
    {!compact && <div className={styles.filters}>
      <select aria-label="Activity status" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All activity</option><option value="confirmed">Confirmed</option><option value="pending">Pending</option><option value="failed">Failed</option></select>
      <select aria-label="Activity network" value={chain} onChange={(event) => setChain(event.target.value)}><option value="all">All networks</option><option value="1">Ethereum</option><option value="8453">Base</option></select>
      <label className={styles.search}><Search size={16} aria-hidden="true" /><input aria-label="Search activity" placeholder="Search activity" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    </div>}
    {!compact && drafts.length > 0 && <details className={styles.drafts}><summary>Drafts <span>({drafts.length})</span></summary>
      {drafts.map((draft) => <div key={draft.id}><span>{operationTitle(draft.operation)}</span><small>Unsubmitted</small>
        <Link href={signatureDraftResumePath(draft)}>Continue</Link><button type="button" aria-label="Dismiss" title="Dismiss draft" onClick={() => { cancelSignatureRequiredDraft(draft.id); void activity.refetch(); }}><X size={16} aria-hidden="true" /></button></div>)}
    </details>}
    {activity.isPending ? <div role="status" aria-label="Loading history" className={styles.loading}><div className="skeleton" /><div className="skeleton" /></div>
      : unavailable ? <div role="status" className={styles.unavailable}><span>History couldn’t load. Nothing was marked complete or failed.</span>
        <button type="button" disabled={activity.isFetching} onClick={() => void activity.refetch()}>Retry</button></div>
      : <ul className={styles.list}>{visible.map((item) => <li key={item.id}>
        <button type="button" className={styles.row} onClick={(event) => { triggerRef.current = event.currentTarget; setSelected(item); setDetailOpen(true); }}>
          <span className={styles.token}><TokenIcon symbol={item.symbol} size={38} /><span><ChainIcon chainId={item.chainId} size={15} /></span></span>
          <span className={styles.label}><strong>{item.title}</strong><span>{item.transfers.length === 1 ? `${formatUnits(item.transfers[0].amountRaw, item.transfers[0].decimals)} ${item.transfers[0].symbol} · ` : ''}{item.chainId === 1 ? 'Ethereum' : 'Base'} · {new Date(item.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></span>
          {item.statusLabel && <span className={styles.status} data-status={item.status}>{item.status === 'confirmed' ? <Check size={14} /> : item.status === 'failed' ? <X size={14} /> : <Clock3 size={14} />}<span>{item.statusLabel}</span></span>}
          <ChevronRight size={15} className={styles.chevron} aria-hidden="true" />
        </button>
      </li>)}</ul>}
    {!compact && !activity.isPending && !activity.data?.partial && visible.length === 0 && <p className={styles.empty}>{rows.length ? 'No matching activity' : 'No activity yet'}</p>}
    {!compact && activity.hasMore && <button type="button" className={styles.more} disabled={loadingMore} onClick={() => {
      setLoadingMore(true); void activity.loadMore().catch(() => undefined).finally(() => setLoadingMore(false));
    }}>{loadingMore ? <RefreshCw size={16} className="animate-spin" aria-label="Loading" /> : 'Load more'}</button>}
    {selected && <ActivityDetail key={selected.id} item={rows.find((item) => item.id === selected.id) ?? selected} open={detailOpen} onClose={() => setDetailOpen(false)} triggerRef={triggerRef} walletAddress={walletAddress} />}
  </section>;
}

function ActivityDetail({ item, open, onClose, triggerRef, walletAddress }: { item: Activity; open: boolean; onClose: () => void; triggerRef: React.RefObject<HTMLButtonElement | null>; walletAddress: Address }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const ref = useOverlayDialog<HTMLDivElement>({ open, onClose, triggerRef, initialFocusRef: closeRef });
  const present = useExitPresence(open, item.id);
  const view = item.recovery;
  const receipt = useQuery({ queryKey: ['activity-receipt', item.chainId, item.hash],
    enabled: open && !view, staleTime: 300_000, gcTime: 600_000, retry: false, refetchOnWindowFocus: false,
    queryFn: () => loadActivityReceipt(item.chainId, item.hash as Hex),
  });
  const indexedReceipt = !view ? receipt.data : undefined;
  const facts = view?.verification === 'receipt' ? buildReceiptPresentation({ chainId: item.chainId, walletAddress,
    status: view.status === 'confirmed' ? 'success' : 'reverted', transfers: view.receiptTransfers, executionCostWei: view.receiptExecutionCostWei,
    nativeValueWei: view.receiptNativeValueWei, transactionKind: view.record.stepKind, bridgeFee: Boolean(view.record.bridge) }) : null;
  const explorer = `https://${item.chainId === 1 ? 'etherscan.io' : 'basescan.org'}/tx/${item.hash}`;
  const bridge = view?.record.bridge;
  if (!present || typeof document === 'undefined') return null;
  return createPortal(<div className={styles.backdrop} data-state={open ? 'open' : 'closed'} inert={!open} aria-hidden={!open || undefined} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Transaction details" className={styles.sheet}>
      <span className={styles.handle} aria-hidden="true" />
      <header><TokenIcon symbol={item.symbol} size={42} /><div><h2>{item.title}</h2><p>{new Date(item.timestamp).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</p></div><button ref={closeRef} type="button" aria-label="Close transaction details" onClick={onClose}><X size={20} /></button></header>
      <div className={styles.detailBody}>
        {item.transfers.length > 0 && indexedReceipt?.status !== 'failed' ? <div className={styles.transfers}>{item.transfers.map((transfer) => {
          const sent = transfer.from.toLowerCase() === walletAddress.toLowerCase();
          const counterparty = sent ? transfer.to : transfer.from;
          return <div key={transfer.id} className={styles.transfer}>
            <div><small>{sent ? 'Sent' : 'Received'} · {item.chainId === 1 ? 'Ethereum' : 'Base'}</small><strong>{formatUnits(transfer.amountRaw, transfer.decimals)} {transfer.symbol}</strong>
              <span><WalletAvatar address={counterparty} size={18} />{sent ? 'To' : 'From'} <span title={counterparty}>{compactAddress(counterparty)}</span></span></div>
            <TokenIcon symbol={transfer.symbol} size={42} />
          </div>;
        })}</div> : facts && <div className={styles.movements}>
          {facts.movements.filter((movement) => !movement.startsWith('Token movement available')).map((movement, i) => <div key={`${movement}:${i}`}><span>{movement.startsWith('received') ? <ArrowDown size={18} /> : <ArrowUpRight size={18} />}</span><strong>{movement}</strong></div>)}
          {facts.nativeValue && <div><ArrowUpRight size={18} /><strong>{facts.nativeValueLabel}: {facts.nativeValue}</strong></div>}
        </div>}
        <dl className={styles.facts}>
          {(item.statusLabel || indexedReceipt) && <div><dt>Status</dt><dd data-status={indexedReceipt?.status ?? item.status}>{indexedReceipt ? indexedReceipt.status === 'confirmed' ? 'Confirmed' : 'Failed' : item.statusLabel}</dd></div>}
          <div><dt>Network</dt><dd><ChainIcon chainId={item.chainId} size={18} />{item.chainId === 1 ? 'Ethereum' : 'Base'}</dd></div>
          {facts?.executionFee && <div><dt>{item.chainId === 8453 ? 'Execution cost' : 'Network cost'}</dt><dd>{facts.executionFee}</dd></div>}
          {!facts?.executionFee && indexedReceipt && <div><dt>{item.chainId === 8453 ? 'Execution cost' : 'Network cost'}</dt><dd>{formatEther(indexedReceipt.executionCost)} ETH</dd></div>}
          <div><dt>Transaction</dt><dd><a href={explorer} target="_blank" rel="noopener noreferrer" onClick={(event) => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && openExternalLink(explorer)) event.preventDefault(); }}>{compactAddress(item.hash)}<ExternalLink size={15} /></a></dd></div>
        </dl>
        {item.positions.length > 0 && <div className={styles.positionLinks}>{item.positions.map((position) => <Link key={`${position.poolAddress}:${position.positionId}`} href={`/positions?position=${encodeURIComponent(`${position.market}:${position.side}:${position.positionId}`)}`}>{position.market} {position.side} #{position.positionId}<ChevronRight size={16} /></Link>)}</div>}
        {view && <details className={styles.technical}><summary>Show more</summary>
          <dl className={styles.facts}><div><dt>To</dt><dd title={view.record.to}>{compactAddress(view.record.to)}</dd></div>
            {view.receiptBlockNumber !== undefined && <div><dt>Block</dt><dd>{view.receiptBlockNumber.toString()}</dd></div>}</dl>
          {view.verification !== 'receipt' && <p>{view.message}</p>}
          {facts?.feeCaveat && <p>{facts.feeCaveat}</p>}
        </details>}
        {open && bridge && view?.status === 'confirmed' && <BridgeTracker sourceChain={item.chainId === 1 ? 'Ethereum' : 'Base'} destinationChain={bridge.destinationChainId === 1 ? 'Ethereum' : 'Base'}
          token={bridge.bridgeToken ?? 'Bridge asset'} amount={formatUnits(BigInt(bridge.amountLD), 18)} sourceTxHash={view.record.hash} status="source_confirmed" sourceOftAddress={bridge.sourceOftAddress} destinationOftAddress={bridge.destinationOftAddress}
          recipient={bridge.recipient} sourceSender={walletAddress} amountLD={BigInt(bridge.amountLD)} minAmountLD={BigInt(bridge.minAmountLD)} destinationBaselineBlock={BigInt(bridge.destinationBaselineBlock)} autoStart />}
      </div>
      <footer><button type="button" onClick={onClose}>Close</button></footer>
    </div>
  </div>, document.body);
}
