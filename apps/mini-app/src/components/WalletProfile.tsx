'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useEnsAddress, useEnsName } from 'wagmi';
import type { Address } from 'viem';
import { ArrowDownToLine, History, Layers2, ExternalLink, LogOut, RefreshCw, Settings, Wallet, X } from 'lucide-react';
import { AssetRowContent, AssetQuantity, networkLabel } from '@/components/AssetPresentation';
import { ActionRow } from '@/components/ProductUI';
import presentation from '@/components/WalletProfile.module.css';
import { AddressChip } from '@/components/ui';
import { useWalletAssets, useWalletBalances } from '@/components/WalletDataProvider';
import { useUsdPrices } from '@/components/PriceProvider';
import {
  ProtocolPositionCard,
  ProtocolPositionNotice,
} from '@/components/ProtocolPositionCard';
import { useProtocolPositions } from '@/components/ProtocolPositionProvider';
import { useWalletDemand, useWalletProfileSession } from '@/components/WalletDemandProvider';
import { ConfirmedPositionCards } from '@/components/ConfirmedPositionCards';
import { formatUsd } from '@/lib/prices';
import { compactAddress } from '@/lib/addressPresentation';
import { userSafeError } from '@/lib/errors';
import { tokenSymbol } from '@/lib/fx/tokenPresentation';
import { haptic, openExternalLink } from '@/lib/telegram';
import { usePrivyWallet } from '@/lib/wallet';
import { canonicalWalletBalancesSnapshot, knownFreshPortfolioSubtotal, mergeFreshCanonicalWalletBalances } from '@/lib/portfolioValuation';
import { walletAssetValuation } from '@/lib/walletAssets';
import styles from '@/app/AccountWorkspace.module.css';
import ConnectWalletButton from '@/components/ConnectWalletButton';
import { ValueOrSkeleton } from '@/components/MissingValue';

const WALLET_PROFILE_DEMAND = { expandedAssets: true, chainPulse: true, positions: true } as const;
const ENS_QUERY_POLICY = { retry: 1, retryDelay: 1_000, staleTime: 5 * 60_000, gcTime: 30 * 60_000, refetchOnWindowFocus: false } as const;

export default function WalletProfile() {
  const wallet = usePrivyWallet();
  const positionState = useProtocolPositions();
  const refreshPositions = positionState.refresh;
  const walletIdentity = wallet.ready && wallet.authenticated ? wallet.address?.toLowerCase() ?? '' : '';
  const { walletProfileAddress: openWallet, setWalletProfileAddress: setOpenWallet } = useWalletProfileSession();
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState('');
  // Hide immediately on account loss/change, then discard the old open state
  // so reconnecting that account cannot silently reopen a prior drawer.
  const open = Boolean(walletIdentity && openWallet === walletIdentity);
  useWalletDemand(WALLET_PROFILE_DEMAND, open);
  useEffect(() => {
    if (openWallet && openWallet !== walletIdentity) setOpenWallet(null);
  }, [openWallet, setOpenWallet, walletIdentity]);
  const walletAssets = useWalletAssets({ address: wallet.address, enabled: open && wallet.ready && Boolean(wallet.address) });
  const assets = walletAssets.data;
  const loading = walletAssets.status === 'idle' || walletAssets.status === 'loading';
  const walletBalances = useWalletBalances({ address: wallet.address, chainId: 1, enabled: open && wallet.ready && Boolean(wallet.address) });
  const priceSnapshot = useUsdPrices();
  const valuationNow = Date.now();
  const displayAssets = assets
    ? mergeFreshCanonicalWalletBalances(assets, walletBalances.data, walletBalances.updatedAt, priceSnapshot, valuationNow)
    : wallet.address
      ? canonicalWalletBalancesSnapshot(wallet.address, walletBalances.data, walletBalances.updatedAt, priceSnapshot,
        walletAssets.status === 'unavailable' ? 'unavailable' : 'pending', valuationNow)
      : null;
  const knownWalletValue = knownFreshPortfolioSubtotal(displayAssets, walletBalances.data, walletBalances.updatedAt, priceSnapshot, valuationNow);
  const walletSnapshotValuation = walletAssetValuation(displayAssets);
  const walletValueIsPartial = knownWalletValue.totalUsd !== null && !walletSnapshotValuation.complete;
  const walletAssetCountLabel = knownWalletValue.assetCount > 0 || walletSnapshotValuation.complete
    ? `${knownWalletValue.assetCount} ${knownWalletValue.assetCount === 1 ? 'asset' : 'assets'}`
    : '—';
  const walletValueLoading = loading || walletBalances.status === 'idle' || walletBalances.status === 'loading' || priceSnapshot.status === 'loading';
  const refreshingBalances = walletAssets.isFetching || walletBalances.isFetching;
  const reverseEnsName = useEnsName({
    address: wallet.address as Address | undefined,
    chainId: 1,
    query: { ...ENS_QUERY_POLICY, enabled: open && Boolean(wallet.address) },
  });
  const forwardEnsAddress = useEnsAddress({
    name: reverseEnsName.data ?? '',
    chainId: 1,
    query: { ...ENS_QUERY_POLICY, enabled: open && Boolean(wallet.address) && Boolean(reverseEnsName.data) },
  });
  const verifiedEnsName = reverseEnsName.data && forwardEnsAddress.data?.toLowerCase() === wallet.address?.toLowerCase()
    ? reverseEnsName.data : null;
  const walletHeading = verifiedEnsName ?? (wallet.address ? compactAddress(wallet.address) : 'Wallet');
  const profileDialogName = verifiedEnsName
    ? `Wallet profile for ${verifiedEnsName}; address ${wallet.address}`
    : `Wallet ${wallet.address}`;
  const openerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open && wallet.ready && wallet.address) {
      void refreshPositions();
    }
  }, [open, refreshPositions, wallet.address, wallet.ready]);

  useEffect(() => {
    if (!open) return;
    const restoreFocusTo = openerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpenWallet(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), summary, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])].filter((element) => element.getAttribute('aria-hidden') !== 'true');
      if (focusable.length === 0) {
        event.preventDefault();
        closeRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      window.requestAnimationFrame(() => restoreFocusTo?.focus());
    };
  }, [open, setOpenWallet]);

  useEffect(() => {
    if (!open) return;
    const onTelegramBack = (event: Event) => {
      const detail = (event as CustomEvent<{ consume?: () => void }>).detail;
      setOpenWallet(null);
      detail?.consume?.();
    };
    window.addEventListener('fxaeon:telegram-back', onTelegramBack);
    return () => window.removeEventListener('fxaeon:telegram-back', onTelegramBack);
  }, [open, setOpenWallet]);

  const nonZero = useMemo(() => displayAssets?.assets.filter((asset) => asset.balanceWei > 0n) ?? [], [displayAssets]);
  const walletExplorer = wallet.chainId === 8453 ? 'https://basescan.org' : 'https://etherscan.io';
  const walletExplorerName = wallet.chainId === 8453 ? 'BaseScan' : 'Etherscan';

  const disconnect = async () => {
    setDisconnectError('');
    setDisconnecting(true);
    try {
      await wallet.disconnect();
      setOpenWallet(null);
      haptic('success');
    } catch (cause) {
      setDisconnectError(userSafeError(cause, 'Wallet disconnect could not be completed.'));
      haptic('error');
    } finally {
      setDisconnecting(false);
    }
  };

  if (!wallet.ready) return <span role="status" className="h-11 w-11 animate-pulse rounded-xl bg-[var(--surface)]"><span className="sr-only">Loading wallet</span></span>;
  if (!wallet.address) {
    return (
      <ConnectWalletButton aria-label="Connect wallet" loadingLabel={<span className="wallet-control-label">Opening…</span>} className={`${styles.walletConnect} glass-press`}>
        <Wallet className="h-[18px] w-[18px]" aria-hidden="true" /> <span className="wallet-control-label">Connect</span>
      </ConnectWalletButton>
    );
  }

  return <>
    <button ref={openerRef} type="button" aria-label="Open wallet profile" onClick={() => { setOpenWallet(walletIdentity); haptic('light'); }}
      className={`${styles.walletTrigger} glass-press flex items-center gap-2 text-[12px] font-semibold`}>
      <Wallet size={18} className="text-mint" aria-hidden="true" /><span className="wallet-control-label">{compactAddress(wallet.address)}</span>
    </button>
    {open && typeof document !== 'undefined' && createPortal(
      <div className={`${styles.walletBackdrop} wallet-profile-backdrop`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpenWallet(null); }}>
        <aside ref={dialogRef} role="dialog" aria-modal="true" aria-label={profileDialogName} className={`${presentation.sheet} wallet-profile-sheet`} onMouseDown={(event) => event.stopPropagation()}>
          <header className={`${presentation.header} wallet-profile-header`}>
            <span className={presentation.handle} aria-hidden="true" />
            <div className={presentation.identity}><h2 title={wallet.address}>{walletHeading}</h2><AddressChip address={wallet.address} /></div>
            <button ref={closeRef} type="button" aria-label="Close wallet profile" onClick={() => setOpenWallet(null)} className={presentation.iconButton}><X size={22} aria-hidden="true" /></button>
          </header>
          <div className={presentation.body}>
            <section className={`${presentation.summary} wallet-profile-summary`} aria-labelledby="wallet-value-heading">
              <div className={presentation.valueTop}><span id="wallet-value-heading">Wallet assets</span><div>
                {walletValueIsPartial && <span className={presentation.partial}>Partial value</span>}
                <button type="button" disabled={refreshingBalances || priceSnapshot.refreshing || positionState.refreshing} aria-label="Refresh balances and positions" title="Refresh balances and positions"
                  className={presentation.iconButton} onClick={() => void Promise.allSettled([priceSnapshot.refresh(), walletAssets.refresh(), walletBalances.refresh(), refreshPositions()])}>
                  <RefreshCw size={18} className={refreshingBalances || priceSnapshot.refreshing ? 'animate-spin' : ''} aria-hidden="true" />
                </button>
              </div></div>
              <strong className={presentation.total}><ValueOrSkeleton value={!knownWalletValue.hasKnownValue || knownWalletValue.totalUsd === null ? '—' : formatUsd(knownWalletValue.totalUsd)} width="xl"
                status={walletValueLoading ? 'loading' : 'unavailable'} label={walletValueLoading ? 'Loading wallet value' : 'Wallet value unavailable'} /></strong>
              <p className={presentation.valueNote}>{walletValueIsPartial ? 'Known value only. Some balances or prices are unavailable.'
                : !knownWalletValue.hasKnownValue ? walletValueLoading ? 'Calculating wallet value' : 'Prices unavailable. Token quantities remain visible.' : walletAssetCountLabel}</p>
              <div className={presentation.actions}>
                <Link href="/qr" onClick={() => setOpenWallet(null)} className={presentation.primaryAction}><ArrowDownToLine size={18} aria-hidden="true" />Receive</Link>
                <Link href="/portfolio" onClick={() => setOpenWallet(null)}>View portfolio</Link>
              </div>
            </section>
            <section className={`${presentation.assets} wallet-profile-assets`} aria-labelledby="wallet-profile-balances-title">
              <div className={presentation.sectionHeading}><h3 id="wallet-profile-balances-title">Assets</h3><span>All networks</span></div>
              {loading && !displayAssets && <div role="status" className="skeleton h-20 w-full rounded-xl" aria-label="Loading assets" />}
              {!loading && !displayAssets && <p role="status" className={presentation.helper}>Balances could not be loaded. Refresh to try again.</p>}
              {!loading && displayAssets && walletSnapshotValuation.complete && nonZero.length === 0 && <p className={presentation.helper}>No token balances detected.</p>}
              <ul className={presentation.assetList}>{nonZero.map((asset) => <li key={asset.id}>
                <details className={presentation.assetDetails}><summary aria-label={`View exact ${tokenSymbol(asset.symbol)} quantity on ${networkLabel(asset.chainId)}`}>
                  <AssetRowContent asset={asset} loading={walletValueLoading} />
                </summary><div className={presentation.exactQuantity}><span>Exact quantity</span><AssetQuantity asset={asset} /></div></details>
              </li>)}</ul>
            </section>
            <section className={presentation.positions} aria-labelledby="wallet-profile-positions-title">
              <ActionRow icon={Layers2} title="Positions" href="/positions" onClick={() => setOpenWallet(null)} value={positionState.status === 'ready' ? `${positionState.positions.length} open` : positionState.status === 'loading' ? 'Checking…' : 'Unavailable'} />
              <h3 id="wallet-profile-positions-title" className="sr-only">Open positions</h3>
              <ProtocolPositionNotice status={positionState.status} failedGroups={positionState.failedGroups} hasPositions={positionState.positions.length + positionState.pendingPositions.length > 0}
                refreshing={positionState.refreshing} onRefresh={() => void refreshPositions()} compact />
              <ConfirmedPositionCards />
              {positionState.positions.slice(0, 2).map((position) => <ProtocolPositionCard key={`${position.market}:${position.side}:${position.info.positionId}`} position={position} compact href="/positions" onNavigate={() => setOpenWallet(null)} />)}
            </section>
            <nav className={`${presentation.links} wallet-profile-links`} aria-label="Wallet profile actions">
              <ActionRow icon={History} title="History" description="Activity on this device" href="/history" onClick={() => setOpenWallet(null)} />
              <ActionRow icon={Settings} title="Settings" href="/settings" onClick={() => setOpenWallet(null)} />
            </nav>
            <a className={presentation.explorer} href={`${walletExplorer}/address/${wallet.address}`} target="_blank" rel="noopener noreferrer"
              onClick={(event) => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && openExternalLink(`${walletExplorer}/address/${wallet.address}`)) event.preventDefault(); }}>
              View on {walletExplorerName}<ExternalLink size={16} aria-hidden="true" />
            </a>
            <div className={presentation.disconnect}>
              <button type="button" onClick={() => void disconnect()} disabled={disconnecting}><LogOut size={18} aria-hidden="true" />{disconnecting ? 'Disconnecting…' : 'Disconnect wallet'}</button>
              {disconnectError && <p role="alert" className={presentation.error}>{disconnectError}</p>}
            </div>
          </div>
        </aside>
      </div>, document.body,
    )}
  </>;
}
