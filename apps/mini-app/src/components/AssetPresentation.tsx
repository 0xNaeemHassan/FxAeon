'use client';

/* eslint-disable @next/next/no-img-element */
import { useState } from 'react';
import TokenIcon from '@/components/TokenIcon';
import { ValueOrSkeleton } from '@/components/MissingValue';
import { formatUsd } from '@/lib/prices';
import { formatExactDecimal } from '@/lib/amount';
import type { WalletAsset } from '@/lib/walletAssets';
import { tokenSymbol } from '@/lib/fx/tokenPresentation';
import styles from './AssetPresentation.module.css';

export const networkLabel = (chainId: number) => chainId === 8453 ? 'Base' : chainId === 1 ? 'Ethereum' : `Network ${chainId}`;
export const displayAssetSymbol = (symbol: string) => tokenSymbol(symbol);
export function compactAssetQuantity(value: string, digits = 8): string {
  const formatted = formatExactDecimal(value, digits);
  if (formatted === '0' && /[1-9]/.test(value)) return digits > 0 ? `<0.${'0'.repeat(digits - 1)}1` : '<1';
  return formatted;
}
export function AssetIcon({ asset, size = 36 }: { asset: WalletAsset; size?: number }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (asset.canonicalKey) return <TokenIcon symbol={asset.canonicalKey} size={size} />;
  let logo: string | null = null;
  try {
    const url = new URL(asset.logoUrl ?? '');
    if (url.protocol === 'https:' && url.hostname === 'static.alchemyapi.io' && !url.username && !url.password && !url.port) logo = url.href;
  } catch { /* Untrusted metadata falls back to initials. */ }
  if (logo && failedUrl !== logo) return <img src={logo} width={size} height={size} alt="" loading="lazy" referrerPolicy="no-referrer" className={styles.icon} onError={() => setFailedUrl(logo)} />;
  return <span className={styles.fallback} style={{ width: size, height: size }} aria-hidden="true">{asset.symbol.slice(0, 2).toUpperCase() || '?'}</span>;
}
export function AssetNetworkIcon({ asset, size = 36 }: { asset: WalletAsset; size?: number }) {
  return <span className={styles.networkIcon} style={{ width: size, height: size }}>
    <AssetIcon asset={asset} size={size} />
    <span className={styles.chainBadge} aria-hidden="true"><img src={`/chain-icons/${asset.chainId === 8453 ? 'base' : 'ethereum'}.png`} width="14" height="14" alt="" /></span>
  </span>;
}
export function AssetQuantity({ asset, compact = false }: { asset: WalletAsset; compact?: boolean }) {
  const symbol = displayAssetSymbol(asset.symbol);
  return <span className={styles.quantity} title={`${asset.balance} ${symbol}`}>
    {compact ? compactAssetQuantity(asset.balance) : asset.balance} <span>{symbol}</span>
  </span>;
}
/** Identical asset hierarchy in Portfolio and the account drawer. */
export function AssetRowContent({ asset, loading = false }: { asset: WalletAsset; loading?: boolean }) {
  return <>
    <AssetNetworkIcon asset={asset} size={34} />
    <span className={styles.name}><strong>{displayAssetSymbol(asset.symbol)}</strong><small>{networkLabel(asset.chainId)}</small></span>
    <span className={styles.worth}>
      <strong>{asset.usdValue === null && !loading ? <span className={styles.unavailable}>Price unavailable</span>
        : <ValueOrSkeleton value={formatUsd(asset.usdValue)} width="sm" status={loading ? 'loading' : 'unavailable'} label="Holding value" />}</strong>
      <AssetQuantity asset={asset} compact />
    </span>
  </>;
}
