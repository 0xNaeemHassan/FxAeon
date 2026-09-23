'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ArrowDownToLine, ArrowLeft, Check, Copy, ExternalLink, ArrowLeftRight, CandlestickChart, PiggyBank } from 'lucide-react';
import { AssetNetworkIcon, networkLabel } from '@/components/AssetPresentation';
import { ValueOrSkeleton } from '@/components/MissingValue';
import type { WalletAsset } from '@/lib/walletAssets';
import { formatUsd } from '@/lib/prices';
import { compactAddress } from '@/lib/addressPresentation';
import { tokenName, tokenSymbol } from '@/lib/fx/tokenPresentation';
import { haptic, openExternalLink } from '@/lib/telegram';
import { ChainIcon } from '@/components/TokenIcon';
import { copyText } from '@/components/ui';
import { useOverlayDialog } from '@/lib/useOverlayDialog';
import styles from './WalletAssetDetails.module.css';

type WalletAssetDetailsProps = {
  asset: WalletAsset;
  walletAddress?: string;
  onNavigate?: () => void;
};

export default function WalletAssetDetails({ asset, walletAddress, onNavigate }: WalletAssetDetailsProps) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const symbol = tokenSymbol(asset.symbol);
  const network = networkLabel(asset.chainId);
  const explorer = asset.chainId === 8453 ? 'https://basescan.org' : 'https://etherscan.io';
  const explorerName = asset.chainId === 8453 ? 'BaseScan' : 'Etherscan';
  const tokenKey = asset.canonicalKey;
  const tradeable = asset.chainId === 1 && tokenKey && ['ETH', 'WETH', 'stETH', 'wstETH', 'WBTC', 'USDC', 'USDT', 'fxUSD'].includes(tokenKey);
  const bridgeable = tokenKey === 'fxUSD' || tokenKey === 'fxSAVE';
  const earnable = asset.chainId === 1 && tokenKey && ['USDC', 'fxUSD', 'fxUSDBasePool', 'fxSAVE'].includes(tokenKey);
  const copyAddress = async () => {
    setCopyFailed(false);
    if (await copyText(walletAddress ?? '')) {
      haptic('success');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } else {
      haptic('error');
      setCopyFailed(true);
    }
  };
  const leave = () => onNavigate?.();
  const explorerTarget = asset.tokenAddress
    ? `${explorer}/token/${asset.tokenAddress}`
    : walletAddress ? `${explorer}/address/${walletAddress}` : null;

  return <div className={styles.details}>
    <div className={styles.hero}>
      <AssetNetworkIcon asset={asset} size={48} />
      <h3>{symbol}</h3>
      <p>{tokenName(asset.symbol)}</p>
      <strong className={styles.holdingValue}><ValueOrSkeleton value={formatUsd(asset.usdValue)} width="md" status="unavailable" label="Holding value unavailable" /></strong>
      <span className={styles.holdingLabel}>Estimated holding value</span>
    </div>

    {walletAddress && <section className={styles.addressPanel} aria-labelledby="wallet-asset-address">
      <h3 id="wallet-asset-address">Wallet address</h3>
      <p className={styles.address}>{walletAddress}</p>
      <button type="button" className={styles.copyButton} onClick={() => void copyAddress()}>
        {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
        {copied ? 'Address copied' : 'Copy address'}
      </button>
      <p className={styles.copyStatus} role="status" aria-live="polite">
        {copyFailed ? 'Copy was blocked. Select the address to copy it manually.' : copied ? 'Address copied.' : ''}
      </p>
    </section>}

    <dl className={styles.facts}>
      <div><dt>Network</dt><dd><span className={styles.chain}><ChainIcon chainId={asset.chainId} size={18} />{network}</span></dd></div>
      {asset.tokenAddress && <div><dt>Contract</dt><dd title={asset.tokenAddress}>{compactAddress(asset.tokenAddress)}</dd></div>}
    </dl>

    <nav className={styles.actions} aria-label={`${symbol} actions`}>
      <Link href="/qr" onClick={leave}><ArrowDownToLine size={18} aria-hidden="true" />Receive on {network}</Link>
      {tradeable && <Link href={`/trade?market=${tokenKey === 'WBTC' ? 'BTC' : 'ETH'}&asset=${tokenKey}`} onClick={leave}><CandlestickChart size={18} aria-hidden="true" />Trade</Link>}
      {bridgeable && <Link href={`/move?token=${encodeURIComponent(tokenKey)}`} onClick={leave}><ArrowLeftRight size={18} aria-hidden="true" />Move</Link>}
      {earnable && <Link href={tokenKey === 'fxSAVE' ? '/earn' : `/earn?mode=deposit&token=${encodeURIComponent(tokenKey)}`} onClick={leave}><PiggyBank size={18} aria-hidden="true" />Earn</Link>}
    </nav>

    {explorerTarget && <a className={styles.explorer} href={explorerTarget} target="_blank" rel="noopener noreferrer"
      onClick={(event) => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && openExternalLink(explorerTarget)) event.preventDefault(); }}>
      {asset.tokenAddress ? 'View contract' : `View wallet on ${explorerName}`}<ExternalLink size={15} aria-hidden="true" />
    </a>}
  </div>;
}

export function WalletAssetModal({ asset, walletAddress, onClose, onBack }: {
  asset: WalletAsset;
  walletAddress?: string;
  onClose: () => void;
  onBack?: () => void;
}) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useOverlayDialog<HTMLElement>({
    open: true,
    onClose,
    triggerRef,
    initialFocusRef: onBack ? backRef : closeRef,
  });
  const title = `${tokenSymbol(asset.symbol)} on ${networkLabel(asset.chainId)}`;

  return typeof document === 'undefined' ? null : createPortal(
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className={styles.modal} role="dialog" aria-modal="true" aria-label={title}>
        <header className={styles.modalHeader}>
          {onBack && <button ref={backRef} type="button" aria-label="Back to wallet assets" onClick={onBack}><ArrowLeft size={19} aria-hidden="true" /></button>}
          <h2>{title}</h2>
          <button ref={closeRef} type="button" aria-label="Close asset details" onClick={onClose}><span aria-hidden="true">×</span></button>
        </header>
        <div className={styles.modalBody}>
          <WalletAssetDetails asset={asset} walletAddress={walletAddress} />
        </div>
      </section>
    </div>, document.body,
  );
}
