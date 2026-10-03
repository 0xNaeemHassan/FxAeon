'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Address } from 'viem';
import { ArrowDownToLine, ArrowUpRight, History, Layers2, ExternalLink, LogOut, RefreshCw, Settings, X } from 'lucide-react';
import { AssetListSkeleton, AssetRowContent, networkLabel } from '@/components/AssetPresentation';
import { ActionRow } from '@/components/ProductUI';
import presentation from '@/components/WalletProfile.module.css';
import balancePresentation from '@/components/BalanceSummary.module.css';
import { WalletAvatar } from '@/components/WalletAvatar';
import { AddressChip } from '@/components/ui';
import { useFxSaveClaimable, useWalletAssets, useWalletBalances } from '@/components/WalletDataProvider';
import { useUsdPrices } from '@/components/PriceProvider';
import { useProtocolPositions } from '@/components/ProtocolPositionProvider';
import { useWalletDemand, useWalletProfileSession } from '@/components/WalletDemandProvider';
import { formatUsd } from '@/lib/prices';
import { compactAddress } from '@/lib/addressPresentation';
import { userSafeError } from '@/lib/errors';
import { tokenSymbol } from '@/lib/fx/tokenPresentation';
import { haptic, openExternalLink } from '@/lib/telegram';
import { usePrivyWallet } from '@/lib/wallet';
import { activeWalletAddress } from '@/lib/wallet/activeWalletAddress';
import { canonicalWalletBalancesSnapshot, mergeFreshCanonicalWalletBalances } from '@/lib/portfolioValuation';
import { walletAssetValuation } from '@/lib/walletAssets';
import { useOverlayDialog } from '@/lib/useOverlayDialog';
import { useExitPresence } from '@/lib/useExitPresence';
import styles from '@/app/AccountWorkspace.module.css';
import ConnectWalletButton from '@/components/ConnectWalletButton';
import { ValueOrSkeleton } from '@/components/MissingValue';
import RecentActivityPreview from '@/components/RecentActivityPreview';
import { selectWalletTasks } from '@/lib/taskState';
import { useVerifiedWalletName } from '@/components/AccountControls';
import headerWalletControl from '@/components/HeaderWalletControl.module.css';
import { WalletAssetModal } from '@/components/WalletAssetDetails';
import { useRefreshAction } from '@/lib/useRefreshAction';
import { WalletExportAction } from '@/components/WalletExportAction';
import { privyConfigured } from '@/lib/privyConfig';

const WALLET_PROFILE_DEMAND = { expandedAssets: true, chainPulse: true, positions: true } as const;
export default function WalletProfile() {
  const pathname = usePathname();
  const wallet = usePrivyWallet();
  const activeAddress = activeWalletAddress(wallet);
  const positionState = useProtocolPositions();
  const refreshPositions = positionState.refresh;
  const walletIdentity = activeAddress?.toLowerCase() ?? '';
  const manualRefresh = useRefreshAction(walletIdentity);
  const { walletProfileAddress: openWallet, setWalletProfileAddress: setOpenWallet } = useWalletProfileSession();
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState('');
  const [exporting, setExporting] = useState(false);
  const currentIdentity = useRef(walletIdentity);
  currentIdentity.current = walletIdentity;
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const openedAtPathRef = useRef(pathname);
  // Hide immediately on account loss/change, then discard the old open state
  // so reconnecting that account cannot silently reopen a prior drawer.
  const open = Boolean(walletIdentity && openWallet === walletIdentity);
  const present = useExitPresence(open, `${walletIdentity}:${pathname}`);
  useEffect(() => {
    if (open && openedAtPathRef.current !== pathname) setOpenWallet(null);
  }, [open, pathname, setOpenWallet]);
  useWalletDemand(WALLET_PROFILE_DEMAND, open);
  useEffect(() => {
    if (openWallet && openWallet !== walletIdentity) setOpenWallet(null);
  }, [openWallet, setOpenWallet, walletIdentity]);
  const walletAssets = useWalletAssets({ address: wallet.address, enabled: open && wallet.ready && Boolean(wallet.address) });
  const assets = walletAssets.data;
  const loading = walletAssets.status === 'idle' || walletAssets.status === 'loading';
  const walletBalances = useWalletBalances({ address: wallet.address, chainId: 1, enabled: open && wallet.ready && Boolean(wallet.address) });
  const claimSnapshot = useFxSaveClaimable({ address: wallet.address, enabled: open && wallet.ready && Boolean(wallet.address) });
  const priceSnapshot = useUsdPrices();
  const valuationNow = Date.now();
  const displayAssets = assets
    ? mergeFreshCanonicalWalletBalances(assets, walletBalances.data, walletBalances.updatedAt, priceSnapshot, valuationNow)
    : wallet.address
      ? canonicalWalletBalancesSnapshot(wallet.address, walletBalances.data, walletBalances.updatedAt, priceSnapshot,
        walletAssets.status === 'unavailable' ? 'unavailable' : 'pending', valuationNow)
      : null;
  const walletSnapshotValuation = walletAssetValuation(displayAssets);
  const walletValueLoading = loading || walletBalances.status === 'idle' || walletBalances.status === 'loading' || priceSnapshot.status === 'loading';
  const currentClaimable = claimSnapshot.status === 'ready' ? claimSnapshot.data : null;
  const claimTask = selectWalletTasks({ walletAddress: wallet.address ?? '', transactions: [], claimable: currentClaimable })
    .find((task) => task.kind === 'withdrawal' && task.state === 'ready');
  const verifiedEnsName = useVerifiedWalletName(wallet.ready && wallet.authenticated ? wallet.address : undefined);
  const walletHeading = verifiedEnsName ?? (activeAddress ? compactAddress(activeAddress) : 'Wallet');
  const profileDialogName = verifiedEnsName
    ? `Wallet profile for ${verifiedEnsName}; address ${activeAddress}`
    : `Wallet ${activeAddress ?? ''}`;
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useOverlayDialog<HTMLElement>({
    open,
    onClose: () => setOpenWallet(null),
    triggerRef: openerRef,
    initialFocusRef: closeRef,
  });

  useEffect(() => {
    if (open && wallet.ready && wallet.address) {
      void refreshPositions();
    }
  }, [open, refreshPositions, wallet.address, wallet.ready]);

  const nonZero = useMemo(() => displayAssets?.assets.filter((asset) => asset.balanceWei > 0n) ?? [], [displayAssets]);
  const selectedAsset = selectedAssetId ? nonZero.find((asset) => asset.id === selectedAssetId) ?? null : null;
  useEffect(() => {
    if (selectedAssetId && !loading && displayAssets && !nonZero.some((asset) => asset.id === selectedAssetId)) setSelectedAssetId(null);
  }, [displayAssets, loading, nonZero, selectedAssetId]);
  useEffect(() => {
    if (!open) setSelectedAssetId(null);
  }, [open]);
  const walletExplorer = wallet.chainId === 8453 ? 'https://basescan.org' : 'https://etherscan.io';
  const walletExplorerName = wallet.chainId === 8453 ? 'BaseScan' : 'Etherscan';
  const refreshAll = () => void manualRefresh.run([priceSnapshot.refresh, walletAssets.refresh, walletBalances.refresh, claimSnapshot.refresh, refreshPositions]);

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
  if (!activeAddress) {
    return (
      <ConnectWalletButton aria-label="Connect wallet" loadingLabel="Opening…" className={`${styles.walletConnect} ${headerWalletControl.trigger} glass-press`}>
        Connect
      </ConnectWalletButton>
    );
  }

  return <>
    <button ref={openerRef} type="button" aria-label="Open wallet profile" onClick={() => { openedAtPathRef.current = pathname; setOpenWallet(walletIdentity); haptic('light'); }}
      className={`${styles.walletTrigger} ${headerWalletControl.trigger} ${headerWalletControl.identityTrigger} glass-press`}>
      <span className={headerWalletControl.identityAvatar}><WalletAvatar address={activeAddress} size={22} /></span>
      <span className={headerWalletControl.identityName}>{verifiedEnsName ?? compactAddress(activeAddress)}</span>
    </button>
    {present && typeof document !== 'undefined' && createPortal(
      <div className={`${styles.walletBackdrop} ${presentation.backdrop} wallet-profile-backdrop`} data-state={open ? 'open' : 'closed'} inert={!open} aria-hidden={!open || undefined} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpenWallet(null); }}>
        <aside ref={dialogRef} role="dialog" aria-modal="true" aria-label={profileDialogName} className={presentation.sheet} onMouseDown={(event) => event.stopPropagation()}>
          <header className={presentation.header}>
            <span className={presentation.handle} aria-hidden="true" />
            <span className={presentation.identityMark}><WalletAvatar address={activeAddress} size={40} /></span>
            <div className={presentation.identity}>
              <div className={presentation.identityTitle}><h2 title={activeAddress}>{walletHeading}</h2>
                {!verifiedEnsName && <AddressChip address={activeAddress} iconOnly />}
              </div>
              {verifiedEnsName && <AddressChip address={activeAddress} />}
            </div>
            <button ref={closeRef} type="button" aria-label="Close wallet profile" onClick={() => setOpenWallet(null)} className={presentation.iconButton}><X size={22} aria-hidden="true" /></button>
          </header>
          <div className={presentation.body}>
            <section className={`${presentation.summary} ${balancePresentation.hero}`} aria-labelledby="wallet-value-heading">
              <div className={presentation.valueTop}><span id="wallet-value-heading">Wallet assets</span><div>
                <button type="button" disabled={manualRefresh.refreshing} aria-busy={manualRefresh.refreshing} aria-label="Refresh balances and positions" title="Refresh balances and positions"
                  className={presentation.iconButton} onClick={refreshAll}>
                  <RefreshCw size={18} className={manualRefresh.refreshing ? 'animate-spin' : ''} aria-hidden="true" />
                </button>
              </div></div>
              <strong className={`${presentation.total} ${balancePresentation.value}`}><ValueOrSkeleton value={walletSnapshotValuation.totalUsd === null ? '—' : formatUsd(walletSnapshotValuation.totalUsd)} width="xl"
                status={walletValueLoading ? 'loading' : 'unavailable'} label={walletValueLoading ? 'Loading wallet value' : 'Wallet value unavailable'} /></strong>
              <div className={presentation.actions}>
                <Link href="/qr" className={presentation.primaryAction}><ArrowDownToLine size={18} aria-hidden="true" />Receive</Link>
                <Link href="/send" className={presentation.primaryAction}><ArrowUpRight size={18} aria-hidden="true" />Send</Link>
              </div>
              <Link href="/portfolio" className={presentation.portfolioLink}>View portfolio<ArrowUpRight size={16} aria-hidden="true" /></Link>
            </section>
            <section className={presentation.assets} aria-labelledby="wallet-profile-balances-title">
              <div className={presentation.sectionHeading}><h3 id="wallet-profile-balances-title">Assets</h3><span>All networks</span></div>
              {loading && nonZero.length === 0 && <AssetListSkeleton />}
              {!loading && nonZero.length === 0 && !walletSnapshotValuation.complete && <div className={presentation.assetRetry}>
                <span role="status">Couldn’t load assets.</span>
                <button type="button" onClick={refreshAll} disabled={manualRefresh.refreshing} aria-busy={manualRefresh.refreshing}>
                  <RefreshCw size={16} aria-hidden="true" />Retry
                </button>
              </div>}
              {!loading && displayAssets && walletSnapshotValuation.complete && nonZero.length === 0 && <p className={presentation.helper}>No token balances detected.</p>}
              <ul className={presentation.assetList}>{nonZero.map((asset) => <li key={asset.id}>
                <button type="button" className={presentation.assetDetails} aria-label={`View ${tokenSymbol(asset.symbol)} details on ${networkLabel(asset.chainId)}`} onClick={() => setSelectedAssetId(asset.id)}>
                  <AssetRowContent asset={asset} loading={walletValueLoading} />
                </button>
              </li>)}</ul>
            </section>
            <section className={presentation.positions} aria-labelledby="wallet-profile-positions-title">
              <ActionRow icon={Layers2} title="Positions" href="/positions" value={<ValueOrSkeleton value={positionState.status === 'ready' ? `${positionState.positions.length} open` : '—'} width="sm" status={positionState.status === 'loading' ? 'loading' : 'unavailable'} label="Open position count" />} />
              <h3 id="wallet-profile-positions-title" className="sr-only">Open positions</h3>
              {claimTask && <ActionRow icon={ArrowDownToLine} title="Claim fxSAVE withdrawal" href={claimTask.href} />}
            </section>
            <RecentActivityPreview walletAddress={wallet.address as Address} />
            <nav className={presentation.links} aria-label="Wallet profile actions">
              <ActionRow icon={History} title="History" href="/history" />
              <ActionRow icon={Settings} title="Settings" href="/settings" />
              {privyConfigured() && wallet.isEmbedded && <WalletExportAction address={activeAddress}
                disabled={exporting || disconnecting}
                onStart={() => flushSync(() => { setExporting(true); setDisconnectError(''); setOpenWallet(null); })}
                onComplete={() => setExporting(false)}
                onError={(message) => {
                  if (currentIdentity.current !== walletIdentity) return;
                  setDisconnectError(message);
                  setOpenWallet(walletIdentity);
                }} />}
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
    {open && selectedAsset && <WalletAssetModal asset={selectedAsset} walletAddress={wallet.address} onClose={() => setSelectedAssetId(null)} onBack={() => setSelectedAssetId(null)} />}
  </>;
}
