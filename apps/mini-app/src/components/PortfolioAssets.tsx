'use client';

// Static export: small allowlisted token logos use native lazy loading and a
// local fallback, without an image-optimization server.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Coins, Search } from 'lucide-react';
import { AssetRowContent, displayAssetSymbol, networkLabel } from '@/components/AssetPresentation';
export { AssetIcon, AssetNetworkIcon, AssetQuantity, displayAssetSymbol, networkLabel } from '@/components/AssetPresentation';
import { ValueOrSkeleton } from '@/components/MissingValue';
import { summarizeWalletAssets, walletAssetCountLabel, type WalletAssetSnapshot } from '@/lib/walletAssets';
import { WalletAssetModal } from '@/components/WalletAssetDetails';
import styles from './PortfolioAssets.module.css';

export type PortfolioNetwork = 'all' | 1 | 8453;

export function PortfolioNetworkTabs({ value, onChange }: { value: PortfolioNetwork; onChange: (value: PortfolioNetwork) => void }) {
  return <div className={styles.networkTabs} role="group" aria-label="Portfolio network">
    {(['all', 1, 8453] as const).map((network) => <button key={network} type="button" aria-pressed={value === network} onClick={() => onChange(network)}>{network === 'all' ? 'All' : networkLabel(network)}</button>)}
  </div>;
}

export function PortfolioAssets({ snapshot, loading, network = 'all', onNetworkChange }: {
  snapshot: WalletAssetSnapshot | null;
  loading: boolean;
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
  const needsStatus = countState !== 'ready' || missingFreshValues;
  const countLabel = countState === 'ready' ? walletAssetCountLabel(assets.length, countState)
    : countState === 'loading' ? '—'
      : countState === 'partial' && assets.length > 0 ? `${assets.length}+ assets` : null;
  const statusLabel = [
    countState === 'loading' ? 'Balances loading.' : countState === 'unavailable' ? 'Some balances unavailable.' : countState === 'partial' ? 'Some balances incomplete.' : null,
    missingFreshValues ? 'Some prices unavailable.' : null,
  ].filter(Boolean).join(' ');
  return <section className={styles.assets} aria-labelledby="portfolio-assets-heading">
    <div className={styles.sectionHeading}>
      <h2 id="portfolio-assets-heading">Assets</h2>
      {countLabel !== null && <span><ValueOrSkeleton value={countLabel} width="sm" status={countState === 'loading' ? 'loading' : 'unavailable'} label={countState === 'loading' ? 'Loading asset count' : 'Known asset count'} /></span>}
    </div>
    {onNetworkChange && <PortfolioNetworkTabs value={network} onChange={onNetworkChange} />}
    {showSearch && <label className={styles.search}><Search size={18} aria-hidden="true" /><span className="sr-only">Search assets</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search assets" autoComplete="off" /></label>}
    {needsStatus && <p className="sr-only" role="status">{statusLabel}</p>}
    {loading && !snapshot ? <div className={styles.loading} role="status" aria-label="Loading assets"><span /><span /><span /></div>
      : !snapshot ? null
      : assets.length === 0 && incomplete && !search ? null
        : assets.length === 0 ? <div className={styles.empty}><Coins size={24} aria-hidden="true" /><p>{search ? 'No matching assets.' : 'No assets on this network yet.'}</p>{!search && <Link href="/qr">Receive assets</Link>}</div>
      : <ul className={styles.assetList}>{visibleAssets.map((asset) => <li key={asset.id}><button type="button" className={styles.assetRow} onClick={() => setSelection({ wallet: snapshot.walletAddress, id: asset.id })} aria-label={`View ${displayAssetSymbol(asset.symbol)} on ${networkLabel(asset.chainId)}`}>
        <AssetRowContent asset={asset} loading={loading} />
      </button></li>)}</ul>}
    {!query && assets.length > 6 && <button type="button" className="min-h-11 w-full rounded-xl px-3 text-[12px] font-medium text-mint" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Show fewer assets' : `View all ${assets.length} assets`}</button>}
    {selected && <WalletAssetModal asset={selected} walletAddress={displaySnapshot?.walletAddress} onClose={() => setSelection(null)} />}
  </section>;
}
