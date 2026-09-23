'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Address } from 'viem';
import { ArrowDownToLine, History, Layers2, ExternalLink, LogOut, RefreshCw, Settings, X } from 'lucide-react';
import { AssetRowContent, networkLabel } from '@/components/AssetPresentation';
import { ActionRow, StatusNotice } from '@/components/ProductUI';
import presentation from '@/components/WalletProfile.module.css';
import { AddressChip } from '@/components/ui';
import { useFxSaveClaimable, useWalletAssets, useWalletBalances } from '@/components/WalletDataProvider';
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
import { useOverlayDialog } from '@/lib/useOverlayDialog';
import styles from '@/app/AccountWorkspace.module.css';
import ConnectWalletButton from '@/components/ConnectWalletButton';
import { ValueOrSkeleton } from '@/components/MissingValue';
import RecentActivityPreview from '@/components/RecentActivityPreview';
import { selectWalletTasks } from '@/lib/taskState';
import { useVerifiedWalletName } from '@/components/AccountControls';
import headerWalletControl from '@/components/HeaderWalletControl.module.css';
import { WalletAssetModal } from '@/components/WalletAssetDetails';
import { useRefreshAction } from '@/lib/useRefreshAction';

const WALLET_PROFILE_DEMAND = { expandedAssets: true, chainPulse: true, positions: true } as const;
export default function WalletProfile() {
  const pathname = usePathname();
  const wallet = usePrivyWallet();
  const positionState = useProtocolPositions();
  const refreshPositions = positionState.refresh;
  const walletIdentity = wallet.ready && wallet.authenticated ? wallet.address?.toLowerCase() ?? '' : '';
  const manualRefresh = useRefreshAction(walletIdentity);
  const { walletProfileAddress: openWallet, setWalletProfileAddress: setOpenWallet } = useWalletProfileSession();
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const openedAtPathRef = useRef(pathname);
  // Hide immediately on account loss/change, then discard the old open state
  // so reconnecting that account cannot silently reopen a prior drawer.
  const open = Boolean(walletIdentity && openWallet === walletIdentity);
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
  const knownWalletValue = knownFreshPortfolioSubtotal(displayAssets, walletBalances.data, walletBalances.updatedAt, priceSnapshot, valuationNow);
  const walletSnapshotValuation = walletAssetValuation(displayAssets);
  const walletValueIsPartial = knownWalletValue.totalUsd !== null && !walletSnapshotValuation.complete;
  const hasValuedAssets = Boolean(displayAssets?.assets.some((asset) => asset.balanceWei > 0n));
  const valuationTaskState = !walletSnapshotValuation.complete && hasValuedAssets
    ? walletValueIsPartial ? 'partial' : 'unavailable'
    : 'complete';
  const walletAssetCountLabel = knownWalletValue.assetCount > 0 || walletSnapshotValuation.complete
    ? `${knownWalletValue.assetCount} ${knownWalletValue.assetCount === 1 ? 'asset' : 'assets'}`
    : '—';
  const walletValueLoading = loading || walletBalances.status === 'idle' || walletBalances.status === 'loading' || priceSnapshot.status === 'loading';
  const refreshingBalances = walletAssets.isFetching || walletBalances.isFetching;
  const refreshing = manualRefresh.refreshing || refreshingBalances || priceSnapshot.refreshing || positionState.refreshing || claimSnapshot.isFetching;
  const currentClaimable = claimSnapshot.status === 'ready' ? claimSnapshot.data : null;
  const accountTasks = selectWalletTasks({ walletAddress: wallet.address ?? '', transactions: [], claimable: currentClaimable,
    valuation: valuationTaskState }).filter((task) => task.kind !== 'transaction');
  const verifiedEnsName = useVerifiedWalletName(wallet.ready && wallet.authenticated ? wallet.address : undefined);
  const walletHeading = verifiedEnsName ?? (wallet.address ? compactAddress(wallet.address) : 'Wallet');
  const profileDialogName = verifiedEnsName
    ? `Wallet profile for ${verifiedEnsName}; address ${wallet.address}`
    : `Wallet ${wallet.address}`;
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
      <ConnectWalletButton aria-label="Connect wallet" loadingLabel="Opening…" className={`${styles.walletConnect} ${headerWalletControl.trigger} glass-press`}>
        Connect
      </ConnectWalletButton>
    );
  }

  return <>
    <button ref={openerRef} type="button" aria-label="Open wallet profile" onClick={() => { openedAtPathRef.current = pathname; setOpenWallet(walletIdentity); haptic('light'); }}
      className={`${styles.walletTrigger} ${headerWalletControl.trigger} ${headerWalletControl.identityTrigger} glass-press`}>
      <span className={headerWalletControl.identityName}>{verifiedEnsName ?? compactAddress(wallet.address)}</span>
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
                <button type="button" disabled={manualRefresh.refreshing} aria-busy={manualRefresh.refreshing} aria-label="Refresh balances and positions" title="Refresh balances and positions"
                  className={presentation.iconButton} onClick={() => void manualRefresh.run([priceSnapshot.refresh, walletAssets.refresh, walletBalances.refresh, claimSnapshot.refresh, refreshPositions])}>
                  <RefreshCw size={18} className={manualRefresh.refreshing ? 'animate-spin' : ''} aria-hidden="true" />
                </button>
              </div></div>
              <strong className={presentation.total}><ValueOrSkeleton value={walletSnapshotValuation.totalUsd === null ? '—' : formatUsd(walletSnapshotValuation.totalUsd)} width="xl"
                status={walletValueLoading ? 'loading' : 'unavailable'} label={walletValueLoading ? 'Loading wallet value' : 'Wallet value unavailable'} /></strong>
              <p className={presentation.valueNote}><ValueOrSkeleton value={walletAssetCountLabel} width="sm" status={loading ? 'loading' : 'unavailable'} label="Wallet asset count" /></p>
              <div className={presentation.actions}>
                <Link href="/qr" className={presentation.primaryAction}><ArrowDownToLine size={18} aria-hidden="true" />Receive</Link>
                <Link href="/portfolio">View portfolio</Link>
              </div>
            </section>
            <section className={`${presentation.assets} wallet-profile-assets`} aria-labelledby="wallet-profile-balances-title">
              <div className={presentation.sectionHeading}><h3 id="wallet-profile-balances-title">Assets</h3><span>All networks</span></div>
              {loading && !displayAssets && <div role="status" className="skeleton h-20 w-full rounded-xl" aria-label="Loading assets" />}
              {!loading && !displayAssets && <p role="status" className={presentation.helper}>Refresh balances</p>}
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
              <ProtocolPositionNotice status={positionState.status} failedGroups={positionState.failedGroups} hasPositions={positionState.positions.length + positionState.pendingPositions.length > 0}
                refreshing={positionState.refreshing} onRefresh={() => void refreshPositions()} compact />
              <ConfirmedPositionCards />
              {positionState.positions.slice(0, 2).map((position) => <ProtocolPositionCard key={`${position.market}:${position.side}:${position.info.positionId}`} position={position} compact href="/positions" />)}
            </section>
            <RecentActivityPreview walletAddress={wallet.address as Address} attentionOnly />
            {accountTasks.length > 0 && <section className={presentation.positions} aria-labelledby="wallet-account-tasks-title">
              <h3 id="wallet-account-tasks-title" className={presentation.sectionHeading}>Needs attention</h3>
              <div className="mt-2 flex flex-col gap-2">
                {accountTasks.filter((task) => task.kind !== 'valuation' || !refreshing).map((task) => <StatusNotice key={task.id} title={task.title}
                  tone={task.state === 'ready' ? 'success' : 'neutral'}
                  action={<Link href={task.href}>
                    {task.kind === 'withdrawal' && task.state === 'ready' ? 'Review claim' : task.kind === 'valuation' ? 'View assets' : 'View'}
                  </Link>}>
                  {task.kind !== 'valuation' && task.detail}
                </StatusNotice>)}
              </div>
            </section>}
            <nav className={`${presentation.links} wallet-profile-links`} aria-label="Wallet profile actions">
              <ActionRow icon={History} title="History" href="/history" />
              <ActionRow icon={Settings} title="Settings" href="/settings" />
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
