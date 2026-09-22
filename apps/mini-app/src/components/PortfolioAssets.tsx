'use client';

// Static export: small allowlisted token logos use native lazy loading and a
// local fallback, without an image-optimization server.
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ArrowDownToLine, ArrowLeftRight, CandlestickChart, Coins, ExternalLink, PiggyBank, RefreshCw, Search, X } from 'lucide-react';
import { AssetQuantity, AssetRowContent, displayAssetSymbol, networkLabel } from '@/components/AssetPresentation';
export { AssetIcon, AssetNetworkIcon, AssetQuantity, displayAssetSymbol, networkLabel } from '@/components/AssetPresentation';
import { AddressChip } from '@/components/ui';
import { ValueOrSkeleton } from '@/components/MissingValue';
import { formatUsd } from '@/lib/prices';
import { summarizeWalletAssets, walletAssetCountLabel, type WalletAsset, type WalletAssetSnapshot } from '@/lib/walletAssets';
import { tokenName } from '@/lib/fx/tokenPresentation';
import styles from './PortfolioAssets.module.css';

export type PortfolioNetwork = 'all' | 1 | 8453;

export function PortfolioNetworkTabs({ value, onChange }: { value: PortfolioNetwork; onChange: (value: PortfolioNetwork) => void }) {
  return <div className={styles.networkTabs} role="group" aria-label="Portfolio network">
    {(['all', 1, 8453] as const).map((network) => <button key={network} type="button" aria-pressed={value === network} onClick={() => onChange(network)}>{network === 'all' ? 'All' : networkLabel(network)}</button>)}
  </div>;
}

export function PortfolioAssets({ snapshot, loading, refreshing = false, onRetry, network = 'all', onNetworkChange }: {
  snapshot: WalletAssetSnapshot | null;
  loading: boolean;
  refreshing?: boolean;
  onRetry?: () => void;
  network?: PortfolioNetwork;
  onNetworkChange?: (value: PortfolioNetwork) => void;
}) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [selection, setSelection] = useState<{ wallet: string; id: string } | null>(null);
  const displaySnapshot = snapshot ? summarizeWalletAssets(snapshot) : null;
  const selected = selection?.wallet === displaySnapshot?.walletAddress ? displaySnapshot?.assets.find((asset) => asset.id === selection?.id) : undefined;
  useEffect(() => { setSelection(null); setSearch(''); setExpanded(false); }, [snapshot?.walletAddress]);
  useEffect(() => { setExpanded(false); }, [network]);
  const query = search.trim().toLowerCase();
  const assets = (displaySnapshot?.assets ?? []).filter((asset) => asset.balanceWei > 0n && (network === 'all' || asset.chainId === network)
    && (!query || [asset.symbol, asset.name, asset.tokenAddress ?? '', networkLabel(asset.chainId)].some((text) => text.toLowerCase().includes(query))))
    .sort((a, b) => (b.usdValue ?? -1) - (a.usdValue ?? -1) || a.symbol.localeCompare(b.symbol) || a.chainId - b.chainId);
  const networks = network === 'all' ? [1, 8453] as const : [network];
  const incomplete = Boolean(displaySnapshot && networks.some((chain) => displaySnapshot.networks[chain].status !== 'ready'));
  const countState = !displaySnapshot
    ? loading ? 'loading' : 'unavailable'
    : !incomplete ? 'ready'
      : networks.some((chain) => displaySnapshot.networks[chain].status === 'pending') ? 'loading'
        : networks.some((chain) => displaySnapshot.networks[chain].status === 'unavailable') ? 'unavailable' : 'partial';

  const missingFreshValues = assets.some((asset) => asset.usdValue === null);
  const showSearch = search.length > 0 || (displaySnapshot?.assets.filter((asset) => asset.balanceWei > 0n).length ?? 0) > 6;
  const visibleAssets = expanded || query ? assets : assets.slice(0, 6);
  const needsRefresh = countState !== 'ready' || missingFreshValues;
  const refreshLabel = refreshing ? 'Refreshing portfolio balances' : 'Refresh portfolio balances';
  const statusLabel = missingFreshValues
    ? 'Some asset values do not have a fresh USD price.'
    : countState === 'unavailable'
    ? 'Some balance reads are unavailable. Known asset values remain visible.'
    : countState === 'partial' ? 'Some balance reads are incomplete. Known asset values remain visible.'
      : 'Loading portfolio balances.';
  return <section className={styles.assets} aria-labelledby="portfolio-assets-heading">
    <div className={styles.sectionHeading}>
      <h2 id="portfolio-assets-heading">Assets</h2>
      <span><ValueOrSkeleton value={walletAssetCountLabel(assets.length, countState)} width="sm" status={countState === 'unavailable' ? 'unavailable' : 'loading'} label={countState === 'unavailable' ? 'Asset count unavailable' : 'Loading asset count'} /></span>
      {needsRefresh && <button type="button" onClick={onRetry} disabled={!onRetry || refreshing} aria-label={refreshLabel} title={refreshLabel} className="glass-press flex min-h-11 min-w-11 items-center justify-center rounded-xl text-mut hover:text-mint disabled:opacity-50">
        <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
      </button>}
    </div>
    {onNetworkChange && <PortfolioNetworkTabs value={network} onChange={onNetworkChange} />}
    {showSearch && <label className={styles.search}><Search size={18} aria-hidden="true" /><span className="sr-only">Search assets</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search assets" autoComplete="off" /></label>}
    {needsRefresh && <p className="px-1 py-2 text-[12px] leading-relaxed text-mut" role="status">{statusLabel}</p>}
    {loading && !snapshot ? <div className={styles.loading} role="status" aria-label="Loading assets"><span /><span /><span /></div>
      : !snapshot ? <span className="sr-only" role="status" aria-live="polite">Asset balances are unavailable. Use the refresh button to retry.</span>
      : assets.length === 0 && incomplete && !search ? null
        : assets.length === 0 ? <div className={styles.empty}><Coins size={24} aria-hidden="true" /><p>{search ? 'No matching assets.' : 'No assets on this network yet.'}</p>{!search && <Link href="/qr">Receive assets</Link>}</div>
      : <ul className={styles.assetList}>{visibleAssets.map((asset) => <li key={asset.id}><button type="button" className={styles.assetRow} onClick={() => setSelection({ wallet: snapshot.walletAddress, id: asset.id })} aria-label={`View ${displayAssetSymbol(asset.symbol)} on ${networkLabel(asset.chainId)}`}>
        <AssetRowContent asset={asset} loading={loading} />
      </button></li>)}</ul>}
    {!query && assets.length > 6 && <button type="button" className="min-h-11 w-full rounded-xl px-3 text-[12px] font-medium text-mint" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Show fewer assets' : `View all ${assets.length} assets`}</button>}
    {selected && <AssetSheet asset={selected} onClose={() => setSelection(null)} />}
  </section>;
}

function AssetSheet({ asset, onClose }: { asset: WalletAsset; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // A few embedded Telegram/WebView shells expose HTMLDialogElement without
    // implementing showModal(). Keep the same portal surface usable there.
    try { node?.showModal(); } catch { node?.setAttribute('open', ''); }
    return () => {
      if (node?.open) {
        try { node.close(); } catch { node.removeAttribute('open'); }
      }
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, []);
  const explorer = asset.chainId === 8453 ? 'https://basescan.org' : 'https://etherscan.io';
  const key = asset.canonicalKey;
  const tradeable = asset.chainId === 1 && key && ['ETH', 'WETH', 'stETH', 'wstETH', 'WBTC', 'USDC', 'USDT', 'fxUSD'].includes(key);
  const bridgeable = key === 'fxUSD' || key === 'fxSAVE';
  const earnable = asset.chainId === 1 && key && ['USDC', 'fxUSD', 'fxUSDBasePool', 'fxSAVE'].includes(key);
  return createPortal(<dialog ref={dialog} className={styles.dialog} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} aria-labelledby="asset-sheet-title">
    <article className={styles.sheet}>
      <header><span className={styles.sheetIdentity}><AssetIcon asset={asset} size={44} /><span><h2 id="asset-sheet-title">{displayAssetSymbol(asset.symbol)}</h2><p>{tokenName(asset.symbol)} · {networkLabel(asset.chainId)}</p></span></span><button type="button" onClick={onClose} aria-label="Close asset details"><X size={20} /></button></header>
      <div className={styles.sheetBalance}><span>Balance</span><strong><ValueOrSkeleton value={formatUsd(asset.usdValue)} width="md" status="unavailable" label="Asset value unavailable" /></strong><AssetQuantity asset={asset} /></div>
      <dl className={styles.details}><div><dt>Current price</dt><dd><ValueOrSkeleton value={formatUsd(asset.priceStatus === 'fresh' ? asset.priceUsd : null)} width="md" status="unavailable" label="Current price unavailable" /></dd></div><div><dt>Network</dt><dd>{networkLabel(asset.chainId)}</dd></div><div><dt>Contract</dt><dd>{asset.tokenAddress ? <AddressChip address={asset.tokenAddress} /> : 'Native asset'}</dd></div></dl>
      <nav className={styles.sheetActions} aria-label={`${asset.symbol} actions`}>
        <Link href="/qr" onClick={onClose}><ArrowDownToLine size={18} />Receive</Link>
        {tradeable && <Link href={`/trade?market=${key === 'WBTC' ? 'BTC' : 'ETH'}&asset=${key}`} onClick={onClose}><CandlestickChart size={18} />Trade</Link>}
        {bridgeable && <Link href={`/move?token=${encodeURIComponent(key)}`} onClick={onClose}><ArrowLeftRight size={18} />Move</Link>}
        {earnable && <Link href={key === 'fxSAVE' ? '/earn' : `/earn?mode=deposit&token=${encodeURIComponent(key)}`} onClick={onClose}><PiggyBank size={18} />Earn</Link>}
      </nav>
      {asset.tokenAddress && <a className={styles.explorer} href={`${explorer}/token/${asset.tokenAddress}`} target="_blank" rel="noopener noreferrer">View contract <ExternalLink size={14} aria-hidden="true" /></a>}
    </article>
  </dialog>, document.body);
}
