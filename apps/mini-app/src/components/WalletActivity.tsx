'use client';

import { Fragment, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Check, ChevronDown, ChevronRight, Code, Copy, ExternalLink,
  Landmark, PiggyBank, RefreshCw, Search, ShieldCheck, TrendingDown, TrendingUp, X, type LucideIcon,
} from 'lucide-react';
import { formatUnits, type Address, type Hex } from 'viem';
import { useQuery } from '@tanstack/react-query';
import TokenIcon, { ChainIcon } from './TokenIcon';
import { SectionTitle } from './ui';
import { BridgeTracker } from './BridgeTracker';
import { useUsdPrices } from '@/components/PriceProvider';
import { useWalletActivity } from '@/lib/useWalletActivity';
import { mergeWalletActivity, operationTitle, type WalletActivity as Activity } from '@/lib/walletActivity';
import {
  activityLegs, formatActivityAmount, networkName, signedLegText, UNVERIFIED_TOKEN_ICON,
  type ActivityClassification, type ActivityFlow, type ActivityGlyph, type ActivityLeg,
} from '@/lib/activityClassification';
import { activityDayKey, activityDayLabel, activityRelativeTime } from '@/lib/activityTime';
import { cancelSignatureRequiredDraft, signatureDraftResumePath } from '@/lib/fx/drafts';
import { useOverlayDialog } from '@/lib/useOverlayDialog';
import { useExitPresence } from '@/lib/useExitPresence';
import { compactAddress } from '@/lib/addressPresentation';
import { openExternalLink } from '@/lib/telegram';
import { copyText } from '@/lib/clipboard';
import { formatUsd, usdValueForUnits, type UsdPriceMap } from '@/lib/prices';
import type { FxTokenKey } from '@/lib/fx/tokens';
import { loadActivityReceipt } from '@/lib/activityReceipt';
import styles from './WalletActivity.module.css';

const GLYPHS: Record<ActivityGlyph, LucideIcon> = {
  send: ArrowUpRight, receive: ArrowDownLeft, swap: ArrowLeftRight, move: ArrowLeftRight, long: TrendingUp,
  short: TrendingDown, earn: PiggyBank, borrow: Landmark, approve: ShieldCheck, contract: Code,
};

export default function WalletActivity({ walletAddress, compact = false, inDialog = false }: { walletAddress: Address; compact?: boolean; inDialog?: boolean }) {
  // A new account owns a new selection/filter state as well as a separate query cache.
  return <ActivityFeed key={walletAddress.toLowerCase()} walletAddress={walletAddress} compact={compact || inDialog} inDialog={inDialog} />;
}

function searchText(item: Activity): string {
  const { classification } = item;
  return [item.title, classification.summary, item.hash, classification.counterparty?.label, classification.counterparty?.address,
    ...classification.flowsIn.map((flow) => flow.symbol), ...classification.flowsOut.map((flow) => flow.symbol)].join(' ').toLowerCase();
}

/** Rows grouped under local day headers, newest first. */
function byDay(rows: readonly Activity[]): { key: string; label: string; rows: Activity[] }[] {
  const groups: { key: string; label: string; rows: Activity[] }[] = [];
  for (const row of rows) {
    const key = activityDayKey(row.timestamp);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.rows.push(row);
    else groups.push({ key, label: activityDayLabel(row.timestamp), rows: [row] });
  }
  return groups;
}

function ActivityFeed({ walletAddress, compact, inDialog }: { walletAddress: Address; compact: boolean; inDialog: boolean }) {
  const activity = useWalletActivity(walletAddress);
  const { prices } = useUsdPrices();
  const [search, setSearch] = useState('');
  const [chain, setChain] = useState('all');
  const [filter, setFilter] = useState('all');
  const [showUnverified, setShowUnverified] = useState(false);
  const [selected, setSelected] = useState<Activity | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { data } = activity;
  // Each source keeps its identity between renders, so typing in search never re-explains the feed.
  const rows = useMemo(() => mergeWalletActivity(data.views, data.protocol?.items ?? [], data.transfers, walletAddress, {
    positionTransfers: data.positionTransfers ?? [], calls: data.calls ?? {},
  }), [data.views, data.protocol, data.transfers, data.positionTransfers, data.calls, walletAddress]);
  const query = search.trim().toLowerCase();
  const filtered = rows.filter((item) => (chain === 'all' || String(item.chainId) === chain)
    // Indexed rows are mined transfers; they belong with confirmed activity.
    && (filter === 'all' || item.status === filter || (filter === 'confirmed' && item.status === 'indexed'))
    && (!query || searchText(item).includes(query)));
  const verified = filtered.filter((item) => !item.spamSuspect);
  const unverified = filtered.filter((item) => item.spamSuspect);
  const visible = compact ? verified.slice(0, 3) : verified;
  const drafts = data.drafts ?? [];
  const unavailable = !activity.isPending && rows.length === 0 && data.partial;
  // A verified-empty preview stays hidden; an unreadable one says so instead of looking empty.
  // The wallet dialog keeps its own History row, so it only previews rows that exist.
  if (compact && !activity.isPending && verified.length === 0 && (!unavailable || inDialog)) return null;
  const open = (item: Activity) => (event: React.MouseEvent<HTMLButtonElement>) => { triggerRef.current = event.currentTarget; setSelected(item); setDetailOpen(true); };
  const retry = () => void activity.refetch();
  const refresh = <button type="button" className={styles.refresh} aria-label="Refresh history" title="Refresh history" disabled={activity.isFetching} onClick={retry}>
    <RefreshCw size={16} className={activity.isFetching ? 'animate-spin' : ''} aria-hidden="true" />
  </button>;
  const list = (items: readonly Activity[]) => compact
    ? <ul className={styles.list}>{items.map((item) => <li key={item.id}><ActivityRow item={item} prices={prices} grouped={false} onOpen={open(item)} /></li>)}</ul>
    : byDay(items).map((day) => <Fragment key={day.key}>
      <h3 className={styles.day}>{day.label}</h3>
      <ul className={styles.list}>{day.rows.map((item) => <li key={item.id}><ActivityRow item={item} prices={prices} grouped onOpen={open(item)} /></li>)}</ul>
    </Fragment>);
  return <section className={styles.section} aria-label={compact ? 'Recent history' : 'Transaction history'}>
    {compact ? <SectionTitle level={inDialog ? 3 : 2} right={<div className={styles.toolbar}>
      {!inDialog && <Link href="/history" aria-label="View all history">View all<ChevronRight size={14} aria-hidden="true" /></Link>}
      {refresh}
    </div>}>History</SectionTitle> : <h2 className="sr-only">History</h2>}
    {!compact && <div className={styles.filters}>
      <select aria-label="Activity status" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All activity</option><option value="confirmed">Confirmed</option><option value="pending">Pending</option><option value="failed">Failed</option></select>
      <select aria-label="Activity network" value={chain} onChange={(event) => setChain(event.target.value)}><option value="all">All networks</option><option value="1">Ethereum</option><option value="8453">Base</option></select>
      {refresh}
      <label className={styles.search}><Search size={16} aria-hidden="true" /><input aria-label="Search activity" placeholder="Search activity" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    </div>}
    {!compact && drafts.length > 0 && <details className={styles.drafts}><summary>Drafts <span>({drafts.length})</span></summary>
      {drafts.map((draft) => <div key={draft.id}><span>{operationTitle(draft.operation)}</span><small>Unsubmitted</small>
        <Link href={signatureDraftResumePath(draft)}>Continue</Link><button type="button" aria-label="Dismiss" title="Dismiss draft" onClick={() => { cancelSignatureRequiredDraft(draft.id); void activity.refetch(); }}><X size={16} aria-hidden="true" /></button></div>)}
    </details>}
    {!activity.isPending && rows.length > 0 && data.partial && <p role="status" className={styles.notice}>
      <span>Some activity could not be loaded.</span>
      <button type="button" disabled={activity.isFetching} onClick={retry}>Retry</button>
    </p>}
    {activity.isPending ? <div role="status" aria-label="Loading history" className={styles.loading}><div className="skeleton" /><div className="skeleton" /></div>
      : unavailable ? <div role="status" className={styles.unavailable}><span>History couldn’t load. Nothing was marked complete or failed.</span>
        <button type="button" disabled={activity.isFetching} onClick={retry}>Retry</button></div>
      : list(visible)}
    {!compact && !activity.isPending && !unavailable && verified.length === 0 && <p className={styles.empty}>
      {rows.length === 0 ? 'No activity yet' : unverified.length && !query && filter === 'all' && chain === 'all' ? 'Only unverified tokens so far' : 'No matching activity'}
    </p>}
    {!compact && activity.hasMore && <button type="button" className={styles.more} disabled={loadingMore} onClick={() => {
      setLoadingMore(true); void activity.loadMore().catch(() => undefined).finally(() => setLoadingMore(false));
    }}>{loadingMore ? <RefreshCw size={16} className="animate-spin" aria-label="Loading" /> : 'Load more'}</button>}
    {!compact && unverified.length > 0 && <>
      <button type="button" className={styles.unverifiedToggle} aria-expanded={showUnverified} onClick={() => setShowUnverified((value) => !value)}>
        {showUnverified ? 'Hide' : 'Show'} unverified ({unverified.length})<ChevronDown size={16} aria-hidden="true" data-open={showUnverified || undefined} />
      </button>
      {showUnverified && <div className={styles.unverifiedList}>
        <p>Tokens FxAeon does not recognize. They may be spam; never interact with links in their names.</p>
        {list(unverified)}
      </div>}
    </>}
    {selected && <ActivityDetail key={selected.id} item={rows.find((item) => item.id === selected.id) ?? selected} open={detailOpen}
      onClose={() => setDetailOpen(false)} triggerRef={triggerRef} prices={prices} />}
  </section>;
}

function priceFor(flow: ActivityFlow, prices: UsdPriceMap): number | null {
  if (!flow.verified || flow.decimals === null) return null;
  return usdValueForUnits(flow.amountRaw, flow.decimals, prices[flow.symbol as FxTokenKey]);
}

/** A leg's text with an "unverified" marker whenever its symbol is not canonical. */
function legText(leg: ActivityLeg): string {
  return leg.flow.verified ? signedLegText(leg) : `${signedLegText(leg)} (unverified)`;
}

type Secondary = { text: string; tone?: 'warn' | 'danger'; title?: string };

/** Exact signed amount for a title tooltip. */
const exactLegText = (leg: ActivityLeg) => `${leg.direction === 'in' ? '+' : '−'}${leg.flow.exact ?? leg.flow.amount ?? '?'} ${leg.flow.symbol}${leg.flow.verified ? '' : ' (unverified)'}`;

/** The right side of a row: a signed headline amount and one quiet line beneath it. Never blank. */
function rowOutcome(item: Activity, prices: UsdPriceMap): { primary?: ActivityLeg; secondary?: Secondary } {
  const { classification } = item;
  const { primary, others } = activityLegs(classification);
  if (item.status === 'pending') return { primary, secondary: { text: item.statusLabel || 'Pending', tone: 'warn' } };
  if (item.status === 'failed') return { primary, secondary: { text: 'Failed', tone: 'danger' } };
  if (primary && !primary.flow.verified) return { primary, secondary: { text: 'Unverified token', tone: 'warn' } };
  if (item.statusLabel === 'Source confirmed') return { primary, secondary: { text: 'Source confirmed' } };
  if (others.length) {
    const shown = others.slice(0, 2).map(legText);
    return { primary, secondary: {
      text: others.length > 2 ? `${shown.join(' · ')} · +${others.length - 2} more` : shown.join(' · '),
      title: others.map(exactLegText).join(' · '),
    } };
  }
  const usd = primary ? priceFor(primary.flow, prices) : null;
  if (usd !== null) return { primary, secondary: { text: formatUsd(usd) } };
  if (classification.approval?.unlimited) return { primary, secondary: { text: 'Unlimited' } };
  if (primary) return { primary };
  return { secondary: { text: item.statusLabel || (item.status === 'indexed' ? 'No tokens moved' : 'Confirmed') } };
}

function TokenMark({ symbol, size }: { symbol: string; size: number }) {
  if (symbol === UNVERIFIED_TOKEN_ICON) return <span className={styles.unverifiedMark} style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}>?</span>;
  return <TokenIcon symbol={symbol} size={size} />;
}

/** One or two token marks with a small badge naming the action. Decorative: the row text says it all. */
function ActivityIcon({ classification, size = 40 }: { classification: ActivityClassification; size?: number }) {
  const Glyph = GLYPHS[classification.glyph];
  const [first, second] = classification.icons;
  const pair = Math.round(size * 0.72);
  return <span className={styles.icon} style={{ width: size, height: size }} aria-hidden="true">
    {!first ? <span className={styles.glyphOnly} data-tone={classification.kind === 'failed' ? 'danger' : undefined}><Glyph size={Math.round(size * 0.45)} strokeWidth={2} /></span>
      : !second ? <TokenMark symbol={first} size={size} />
      : <><span className={styles.pairBack}><TokenMark symbol={first} size={pair} /></span><span className={styles.pairFront}><TokenMark symbol={second} size={pair} /></span></>}
    {first && <span className={styles.badge} data-tone={classification.kind === 'failed' ? 'danger' : undefined}><Glyph size={11} strokeWidth={2.6} /></span>}
  </span>;
}

function ActivityRow({ item, prices, grouped, onOpen }: { item: Activity; prices: UsdPriceMap; grouped: boolean; onOpen: (event: React.MouseEvent<HTMLButtonElement>) => void }) {
  const { classification } = item;
  const { primary, secondary } = rowOutcome(item, prices);
  const network = networkName(item.chainId);
  const where = classification.counterparty
    ? [classification.counterparty.label, item.chainId === 8453 ? network : null] : [network];
  const subtitle = [...where, activityRelativeTime(item.timestamp, Date.now(), grouped)].filter(Boolean).join(' · ');
  return <button type="button" className={styles.row} onClick={onOpen}>
    <ActivityIcon classification={classification} />
    <span className={styles.label}><strong>{item.title}</strong><span title={subtitle}>{subtitle}</span></span>
    <span className={styles.outcome}>
      {primary && <strong className={styles.amount} data-direction={primary.direction} title={exactLegText(primary)}>{signedLegText(primary)}</strong>}
      {secondary && <span className={styles.secondary} data-tone={secondary.tone} title={secondary.title ?? secondary.text}>{secondary.text}</span>}
    </span>
    <ChevronRight size={15} className={styles.chevron} aria-hidden="true" />
  </button>;
}

const explorerHost = (chainId: 1 | 8453) => chainId === 1 ? 'https://etherscan.io' : 'https://basescan.org';

function ExplorerLink({ href, children, label }: { href: string; children: React.ReactNode; label?: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label}
    onClick={(event) => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && openExternalLink(href)) event.preventDefault(); }}>
    {children}<ExternalLink size={14} aria-hidden="true" />
  </a>;
}

function FlowList({ label, legs, prices }: { label: string; legs: ActivityLeg[]; prices: UsdPriceMap }) {
  return <section className={styles.flows} aria-label={label}>
    <h3>{label}</h3>
    <ul>{legs.map((leg) => {
      const usd = priceFor(leg.flow, prices);
      return <li key={`${leg.direction}:${leg.flow.token ?? 'native'}`} className={styles.flow}>
        <span className={styles.flowToken}>
          <span aria-hidden="true"><TokenMark symbol={leg.flow.verified ? leg.flow.symbol : UNVERIFIED_TOKEN_ICON} size={30} /></span>
          <span className={styles.flowSymbol} title={leg.flow.token ?? undefined}>{leg.flow.symbol}</span>
          {!leg.flow.verified && <span className={styles.unverified}>Unverified</span>}
        </span>
        <span className={styles.flowAmount}>
          <strong data-direction={leg.direction} title={leg.flow.exact ?? undefined}>{leg.flow.amount === null ? 'Amount unknown' : `${leg.direction === 'in' ? '+' : '−'}${leg.flow.amount}`}</strong>
          {usd !== null && <small>{formatUsd(usd)}</small>}
        </span>
      </li>;
    })}</ul>
  </section>;
}

function counterpartyTerm(classification: ActivityClassification): string {
  const kind = classification.kind === 'failed' ? classification.attempted : classification.kind;
  if (kind === 'send') return 'To';
  if (kind === 'receive' || kind === 'bridgeIn') return 'From';
  if (kind === 'approve') return 'Spender';
  return 'With';
}

function ActivityDetail({ item, open, onClose, triggerRef, prices }: { item: Activity; open: boolean; onClose: () => void; triggerRef: React.RefObject<HTMLButtonElement | null>; prices: UsdPriceMap }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const ref = useOverlayDialog<HTMLDivElement>({ open, onClose, triggerRef, initialFocusRef: closeRef });
  const present = useExitPresence(open, item.id);
  const view = item.recovery;
  const { classification } = item;
  const receipt = useQuery({ queryKey: ['activity-receipt', item.chainId, item.hash],
    enabled: open && !view, staleTime: 300_000, gcTime: 600_000, retry: false, refetchOnWindowFocus: false,
    queryFn: () => loadActivityReceipt(item.chainId, item.hash as Hex),
  });
  const indexedReceipt = !view ? receipt.data : undefined;
  const failed = indexedReceipt?.status === 'failed' || item.status === 'failed';
  const legs = activityLegs(classification);
  const all = [...(legs.primary ? [legs.primary] : []), ...legs.others];
  const sent = failed ? [] : all.filter((leg) => leg.direction === 'out');
  const received = failed ? [] : all.filter((leg) => leg.direction === 'in');
  const costWei = view?.receiptExecutionCostWei ?? indexedReceipt?.executionCost;
  const cost = costWei !== undefined ? formatActivityAmount(costWei, 18) : null;
  const status = indexedReceipt ? indexedReceipt.status === 'confirmed' ? 'Confirmed' : 'Failed'
    : view || item.statusLabel ? item.statusLabel
      : receipt.isFetching ? 'Checking…' : null;
  const statusTone = indexedReceipt?.status ?? item.status;
  // Only amounts that rounding changed need their exact value spelled out.
  const rounded = [...sent, ...received].filter((leg) => leg.flow.exact !== null && leg.flow.exact !== leg.flow.amount?.replace(/,/g, ''));
  const exactLine = rounded.map((leg) => `${leg.direction === 'in' ? '+' : '−'}${leg.flow.exact} ${leg.flow.symbol}${leg.flow.verified ? '' : ' (unverified)'}`).join(', ');
  const counterparty = classification.counterparty;
  const bridge = view?.record.bridge;
  const explorer = `${explorerHost(item.chainId)}/tx/${item.hash}`;
  if (!present || typeof document === 'undefined') return null;
  return createPortal(<div className={styles.backdrop} data-state={open ? 'open' : 'closed'} inert={!open} aria-hidden={!open || undefined} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Transaction details" className={styles.sheet}>
      <span className={styles.handle} aria-hidden="true" />
      <header>
        <ActivityIcon classification={classification} size={44} />
        <div><h2>{classification.title}</h2><p>{failed && !view ? `This transaction failed on ${networkName(item.chainId)}. Nothing moved except the network fee.` : classification.summary}</p></div>
        <button ref={closeRef} type="button" aria-label="Close transaction details" onClick={onClose}><X size={20} aria-hidden="true" /></button>
      </header>
      <div className={styles.detailBody}>
        {sent.length > 0 && <FlowList label={item.status === 'pending' ? 'Sending' : 'You sent'} legs={sent} prices={prices} />}
        {received.length > 0 && <FlowList label={item.status === 'pending' ? 'Receiving' : 'You received'} legs={received} prices={prices} />}
        {(sent.length > 0 || received.length > 0) && Object.keys(prices).length > 0 && <p className={styles.caption}>USD values use current prices.</p>}
        <dl className={styles.facts}>
          {classification.approval && <div><dt>Allowance</dt><dd>{classification.approval.unlimited ? 'Unlimited'
            : classification.approval.amount !== null ? `${classification.approval.amount} ${classification.approval.verified ? classification.approval.token : 'tokens'}` : 'Not shown'}</dd></div>}
          {counterparty && <div><dt>{counterpartyTerm(classification)}</dt><dd className={styles.party}>
            {counterparty.known && <span>{counterparty.label}</span>}
            <ExplorerLink href={`${explorerHost(item.chainId)}/address/${counterparty.address}`} label={`View ${counterparty.known ? counterparty.label : compactAddress(counterparty.address)} on ${item.chainId === 1 ? 'Etherscan' : 'Basescan'}`}>
              <span title={counterparty.address}>{compactAddress(counterparty.address)}</span>
            </ExplorerLink>
          </dd></div>}
          <div><dt>Network</dt><dd><span className={styles.factIcon} aria-hidden="true"><ChainIcon chainId={item.chainId} size={18} /></span>{networkName(item.chainId)}</dd></div>
          {cost && costWei !== undefined && <div><dt>{item.chainId === 8453 ? 'Execution cost' : 'Network cost'}</dt><dd title={`${formatUnits(costWei, 18)} ETH`}>{cost} ETH</dd></div>}
          {status && <div><dt>Status</dt><dd data-status={statusTone}>{status}</dd></div>}
          <div><dt>Date</dt><dd>{new Date(item.timestamp).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</dd></div>
          <div><dt>Transaction</dt><dd><ExplorerLink href={explorer} label={`View transaction ${compactAddress(item.hash)} on ${item.chainId === 1 ? 'Etherscan' : 'Basescan'}`}>{compactAddress(item.hash)}</ExplorerLink></dd></div>
        </dl>
        {exactLine && <div className={styles.exact}>
          <div><small>Exact amounts</small><code>{exactLine}</code></div>
          <button type="button" aria-label={copied ? 'Exact amounts copied' : 'Copy exact amounts'} title="Copy exact amounts" onClick={async () => {
            if (await copyText(exactLine)) { setCopied(true); setTimeout(() => setCopied(false), 1_800); }
          }}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}</button>
        </div>}
        {item.positions.length > 0 && <div className={styles.positionLinks}>{item.positions.map((position) => <Link key={`${position.poolAddress}:${position.positionId}`} href={`/positions?position=${encodeURIComponent(`${position.market}:${position.side}:${position.positionId}`)}`}>{position.market} {position.side} #{position.positionId}<ChevronRight size={16} aria-hidden="true" /></Link>)}</div>}
        {view && <details className={styles.technical}><summary>Show more</summary>
          <dl className={styles.facts}><div><dt>To</dt><dd title={view.record.to}>{compactAddress(view.record.to)}</dd></div>
            {view.receiptBlockNumber !== undefined && <div><dt>Block</dt><dd>{view.receiptBlockNumber.toString()}</dd></div>}</dl>
          {view.verification !== 'receipt' && <p>{view.message}</p>}
          {item.chainId === 8453 && cost && <p>The execution cost covers Base gas only; the L1 data and operator fees are not included.</p>}
        </details>}
        {open && bridge && view?.status === 'confirmed' && <BridgeTracker sourceChain={item.chainId === 1 ? 'Ethereum' : 'Base'} destinationChain={bridge.destinationChainId === 1 ? 'Ethereum' : 'Base'}
          token={bridge.bridgeToken ?? 'Bridge asset'} amount={formatActivityAmount(BigInt(bridge.amountLD), 18) ?? ''} sourceTxHash={view.record.hash} status="source_confirmed" sourceOftAddress={bridge.sourceOftAddress} destinationOftAddress={bridge.destinationOftAddress}
          recipient={bridge.recipient} sourceSender={view.record.walletAddress} amountLD={BigInt(bridge.amountLD)} minAmountLD={BigInt(bridge.minAmountLD)} destinationBaselineBlock={BigInt(bridge.destinationBaselineBlock)} autoStart />}
      </div>
      <footer><button type="button" onClick={onClose}>Close</button></footer>
    </div>
  </div>, document.body);
}
