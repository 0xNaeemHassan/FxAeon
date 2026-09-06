'use client';

// Static export: small allowlisted token logos use native lazy loading and a
// local fallback, without an image-optimization server.
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ArrowDownToLine, ArrowLeftRight, CandlestickChart, Coins, ExternalLink, PiggyBank, Search, X } from 'lucide-react';
import TokenIcon from '@/components/TokenIcon';
import { AddressChip } from '@/components/ui';
import { formatUsd } from '@/lib/prices';
import { walletAssetCountLabel, type WalletAsset, type WalletAssetSnapshot } from '@/lib/walletAssets';
import styles from './PortfolioAssets.module.css';

export type PortfolioNetwork = 'all' | 1 | 8453;
export const networkLabel = (chainId: number) => chainId === 8453 ? 'Base' : 'Ethereum';

export function PortfolioNetworkTabs({ value, onChange }: { value: PortfolioNetwork; onChange: (value: PortfolioNetwork) => void }) {
  return <div className={styles.networkTabs} role="group" aria-label="Portfolio network">
    {(['all', 1, 8453] as const).map((network) => <button key={network} type="button" aria-pressed={value === network} onClick={() => onChange(network)}>{network === 'all' ? 'All' : networkLabel(network)}</button>)}
  </div>;
}

export function AssetIcon({ asset, size = 36 }: { asset: WalletAsset; size?: number }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (asset.canonicalKey) return <TokenIcon symbol={asset.canonicalKey} size={size} />;
  // Never request arbitrary logo hosts from indexed metadata.
  let logo: string | null = null;
  try { const url = new URL(asset.logoUrl ?? ''); if (url.protocol === 'https:' && url.hostname === 'static.alchemyapi.io' && !url.username && !url.password && !url.port) logo = url.href; } catch { /* Initials are the fallback. */ }
  if (logo && failedUrl !== logo) return <img src={logo} width={size} height={size} alt="" loading="lazy" referrerPolicy="no-referrer" className={styles.assetIcon} onError={() => setFailedUrl(logo)} />;
  return <span className={styles.assetFallback} style={{ width: size, height: size }} aria-hidden="true">{asset.symbol.slice(0, 2).toUpperCase() || <Coins size={18} />}</span>;
}

/** Exact decimal text stays available even when a row's long quantity wraps. */
export function AssetQuantity({ asset }: { asset: WalletAsset }) {
  return <span className={styles.quantity}>{asset.balance} <span>{asset.symbol}</span></span>;
}

export function PortfolioAssets({ snapshot, loading, network = 'all' }: { snapshot: WalletAssetSnapshot | null; loading: boolean; network?: PortfolioNetwork }) {
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<{ wallet: string; id: string } | null>(null);
  const selected = selection?.wallet === snapshot?.walletAddress ? snapshot?.assets.find((asset) => asset.id === selection?.id) : undefined;
  useEffect(() => { setSelection(null); setSearch(''); }, [snapshot?.walletAddress]);
  const assets = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (snapshot?.assets ?? []).filter((asset) => asset.balanceWei > 0n && (network === 'all' || asset.chainId === network)
      && (!query || [asset.symbol, asset.name, asset.tokenAddress ?? '', networkLabel(asset.chainId)].some((text) => text.toLowerCase().includes(query))))
      .sort((a, b) => (b.usdValue ?? -1) - (a.usdValue ?? -1) || a.symbol.localeCompare(b.symbol) || a.chainId - b.chainId);
  }, [snapshot, search, network]);
  const networks = network === 'all' ? [1, 8453] as const : [network];
  const incomplete = Boolean(snapshot && networks.some((chain) => snapshot.networks[chain].status !== 'ready'));
  const countState = !snapshot
    ? loading ? 'loading' : 'unavailable'
    : !incomplete ? 'ready'
      : networks.some((chain) => snapshot.networks[chain].status === 'pending') ? 'loading'
        : networks.some((chain) => snapshot.networks[chain].status === 'unavailable') ? 'unavailable' : 'partial';

  return <section className={styles.assets} aria-labelledby="portfolio-assets-heading">
    <div className={styles.sectionHeading}><h2 id="portfolio-assets-heading">Assets</h2><span>{walletAssetCountLabel(assets.length, countState)}</span></div>
    <label className={styles.search}><Search size={18} aria-hidden="true" /><span className="sr-only">Search assets</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search assets" autoComplete="off" /></label>
    {loading && !snapshot ? <div className={styles.loading} role="status" aria-label="Loading assets"><span /><span /><span /></div>
      : !snapshot ? <p className={styles.empty} role="status">Assets could not load. Refresh to try again.</p>
      : assets.length === 0 ? <div className={styles.empty}><Coins size={24} aria-hidden="true" /><p>{search ? 'No matching assets.' : incomplete ? 'No assets found in the balances available so far.' : 'No assets on this network yet.'}</p>{!search && <Link href="/qr">Receive assets</Link>}</div>
      : <ul className={styles.assetList}>{assets.map((asset) => <li key={asset.id}><button type="button" className={styles.assetRow} onClick={() => setSelection({ wallet: snapshot.walletAddress, id: asset.id })} aria-label={`View ${asset.symbol} on ${networkLabel(asset.chainId)}`}>
        <AssetIcon asset={asset} /><span className={styles.assetName}><strong>{asset.symbol}</strong><small>{networkLabel(asset.chainId)}</small></span>
        <span className={styles.assetWorth}><strong key={asset.usdValue} className={styles.changedValue}>{formatUsd(asset.usdValue)}</strong><AssetQuantity asset={asset} /></span>
      </button></li>)}</ul>}
    {incomplete && snapshot && <p className={styles.networkNote} role="status">{networks.filter((chain) => snapshot.networks[chain].status !== 'ready').map(networkLabel).join(' and ')} balances may be incomplete.</p>}
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
      <header><span className={styles.sheetIdentity}><AssetIcon asset={asset} size={44} /><span><h2 id="asset-sheet-title">{asset.symbol}</h2><p>{asset.name} · {networkLabel(asset.chainId)}</p></span></span><button type="button" onClick={onClose} aria-label="Close asset details"><X size={20} /></button></header>
      <div className={styles.sheetBalance}><span>Balance</span><strong>{formatUsd(asset.usdValue)}</strong><AssetQuantity asset={asset} /></div>
      <dl className={styles.details}><div><dt>Current price</dt><dd>{formatUsd(asset.priceStatus === 'fresh' ? asset.priceUsd : null)}</dd></div><div><dt>Network</dt><dd>{networkLabel(asset.chainId)}</dd></div><div><dt>Contract</dt><dd>{asset.tokenAddress ? <AddressChip address={asset.tokenAddress} /> : 'Native asset'}</dd></div></dl>
      <nav className={styles.sheetActions} aria-label={`${asset.symbol} actions`}>
        <Link href="/qr" onClick={onClose}><ArrowDownToLine size={18} />Receive</Link>
        {tradeable && <Link href={`/trade?market=${key === 'WBTC' ? 'BTC' : 'ETH'}&asset=${key}`} onClick={onClose}><CandlestickChart size={18} />Trade</Link>}
        {bridgeable && <Link href="/move" onClick={onClose}><ArrowLeftRight size={18} />Move</Link>}
        {earnable && <Link href="/earn" onClick={onClose}><PiggyBank size={18} />Earn</Link>}
      </nav>
      {asset.tokenAddress && <a className={styles.explorer} href={`${explorer}/token/${asset.tokenAddress}`} target="_blank" rel="noopener noreferrer">View contract <ExternalLink size={14} aria-hidden="true" /></a>}
    </article>
  </dialog>, document.body);
}
