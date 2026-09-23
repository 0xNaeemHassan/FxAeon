'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  CandlestickChart,
  ChevronRight,
  CircleDollarSign,
  PiggyBank,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { formatUnits, type Address } from 'viem';
import { MarketMiniCard } from '@/components/MarketChart';
import { useUsdPrices } from '@/components/PriceProvider';
import { useFxSaveClaimable, useWalletBalances } from '@/components/WalletDataProvider';
import { useWalletAssets, useRealtimeChainState } from '@/components/WalletDataProvider';
import {
  positionIsStale,
  ProtocolPositionCard,
  ProtocolPositionNotice,
  ProtocolPositionSkeleton,
} from '@/components/ProtocolPositionCard';
import { useProtocolPositions } from '@/components/ProtocolPositionProvider';
import { ConfirmedPositionCards } from '@/components/ConfirmedPositionCards';
import RecentActivityPreview from '@/components/RecentActivityPreview';
import TokenIcon from '@/components/TokenIcon';
import { AppShell, SectionTitle } from '@/components/ui';
import { ActionRow, Disclosure, MetricRows, PageHeading, ProductSurface, RowGroup, StatusNotice } from '@/components/ProductUI';
import { formatExactDecimal } from '@/lib/amount';
import { freshDisplayPrices } from '@/lib/displayPrices';
import presentation from '@/components/PortfolioWorkspace.module.css';
import {
  assertConfiguredPublicClientChain,
  getFxReadFacade,
  withReadDeadline,
  type WalletBalancesResult,
} from '@/lib/fx';
import { positionTokenDecimals, type UiPosition } from '@/app/trade/fxUi';
import { formatUsd, priceKeyForSymbol, usdValueForUnits, type UsdPriceMap } from '@/lib/prices';
import { walletAssetValuation } from '@/lib/walletAssets';
import { canonicalWalletBalancesSnapshot, knownFreshPortfolioSubtotal, mergeFreshCanonicalWalletBalances } from '@/lib/portfolioValuation';
import { calculatePositionUsdValuation } from '@/lib/positionValuation';
import { fxSaveUsdValue, normalizedFxSaveAssetsWei } from '@/lib/fxSaveUnits';
import { haptic } from '@/lib/telegram';
import { usePrivyWallet, useWalletReadyTimeout } from '@/lib/wallet';
import { claimAvailability, type ClaimableLike } from '@/lib/earnState';
import { selectWalletTasks } from '@/lib/taskState';
import styles from '@/app/AccountWorkspace.module.css';
import ConnectWalletButton from '@/components/ConnectWalletButton';
import { ValueOrSkeleton } from '@/components/MissingValue';
import { PortfolioAssets, type PortfolioNetwork } from '@/components/PortfolioAssets';
import { PortfolioWorkspace } from '@/components/ProductLayout';
import { useRefreshAction } from '@/lib/useRefreshAction';

const EMPTY_FX_SAVE: FxSaveSnapshot = {
  status: 'idle',
  fxSaveShares: null,
  fxSaveAssets: null,
  claimable: null,
};

/**
 * Portfolio deliberately reports only state that FxAeon can verify. Wallet
 * value uses complete fresh reads. Individual holdings remain visible while
 * the total is loading, without presenting a subtotal as the portfolio value.
 */
export default function PortfolioPage() {
  return (
    <AppShell tabs>
      <PortfolioWorkspace className={presentation.workspace}>
        <PageHeading title="Portfolio" />
        <PortfolioWallet />
      </PortfolioWorkspace>
    </AppShell>
  );
}

function PortfolioWallet() {
  const walletState = usePrivyWallet();
  const positionState = useProtocolPositions();
  const { ready, authenticated } = walletState;
  const wallet = walletState.selectedWallet;
  const walletTimedOut = useWalletReadyTimeout(ready && walletState.ready);
  const priceSnapshot = useUsdPrices();
  const displayPrices = freshDisplayPrices(priceSnapshot);
  const walletAddress = authenticated && ready && walletState.ready ? wallet?.address : undefined;
  const identity = walletAddress?.toLowerCase() ?? '';
  const manualRefresh = useRefreshAction(identity);
  const walletBalances = useWalletBalances({ address: walletAddress, chainId: 1, enabled: Boolean(walletAddress) });
  const claimableQuery = useFxSaveClaimable({ address: walletAddress, enabled: Boolean(walletAddress) });
  const liveAssets = useWalletAssets({ address: walletAddress, enabled: Boolean(walletAddress) });
  const [network, setNetwork] = useState<PortfolioNetwork>('all');
  const [fxSaveState, setFxSaveState] = useState<{ identity: string; snapshot: FxSaveSnapshot }>({ identity: '', snapshot: EMPTY_FX_SAVE });
  const [fxSaveRefreshing, setFxSaveRefreshing] = useState<{ identity: string; active: boolean }>({ identity: '', active: false });
  const fxSaveStateRef = useRef(fxSaveState);
  fxSaveStateRef.current = fxSaveState;
  const fxSaveSnapshot = fxSaveState.identity === identity ? fxSaveState.snapshot : EMPTY_FX_SAVE;
  const requestId = useRef(0);
  const realtime = useRealtimeChainState(1) as import('@/lib/realtimeChain').RealtimeChainState;
  const protocolBlockRef = useRef('');
  const protocolRequest = useRef<{ identity: string; promise: Promise<void> } | null>(null);

  const loadProtocol = useCallback(() => {
    if (!walletAddress) return Promise.resolve();
    if (protocolRequest.current?.identity === identity) return protocolRequest.current.promise;
    const promise = (async () => {
    const activeRequest = ++requestId.current;
    const previousState = fxSaveStateRef.current;
    const previous = previousState.identity === identity ? previousState.snapshot : EMPTY_FX_SAVE;
    const hasVerifiedSnapshot = previous.status !== 'idle' && previous.status !== 'loading';
    setFxSaveRefreshing({ identity, active: true });
    // Keep a verified same-wallet snapshot visible while a block-triggered
    // refresh is pending. Reset only when this is the first read for a new
    // wallet identity, so the headline never flickers during background work.
    if (!hasVerifiedSnapshot) setFxSaveState({ identity, snapshot: { ...EMPTY_FX_SAVE, status: 'loading' } });
    try {
      await withReadDeadline(assertConfiguredPublicClientChain(1));
      if (requestId.current !== activeRequest) return;
      const sdk = getFxReadFacade();
      const fxSave = await withReadDeadline(sdk.getFxSaveBalance({ userAddress: walletAddress }));
      if (requestId.current !== activeRequest) return;

      setFxSaveState({
        identity,
        snapshot: {
          status: 'ready',
          fxSaveShares: formatProtocolAmount(fxSave.balanceWei),
          fxSaveAssets: normalizedFxSaveAssetsWei(fxSave.balanceWei, fxSave.assetsWei) !== undefined
            ? formatProtocolAmount(normalizedFxSaveAssetsWei(fxSave.balanceWei, fxSave.assetsWei)!)
            : null,
          claimable: null,
        },
      });
    } catch {
      if (requestId.current === activeRequest) {
        setFxSaveState({ identity, snapshot: hasVerifiedSnapshot
          ? { ...previous, status: 'unavailable', claimable: null }
          : { ...EMPTY_FX_SAVE, status: 'unavailable' } });
      }
    } finally {
      if (requestId.current === activeRequest) setFxSaveRefreshing({ identity, active: false });
    }
    })().finally(() => {
      if (protocolRequest.current?.promise === promise) protocolRequest.current = null;
    });
    protocolRequest.current = { identity, promise };
    return promise;
  }, [identity, walletAddress]);

  useEffect(() => {
    if (walletAddress) void loadProtocol();
    return () => { requestId.current += 1; protocolRequest.current = null; };
  }, [loadProtocol, walletAddress]);

  useEffect(() => {
    if (!walletAddress || realtime.status !== 'live' || realtime.latestBlockNumber === null) return;
    const key = `${identity}:${realtime.latestBlockNumber}`;
    if (protocolBlockRef.current === key) return;
    protocolBlockRef.current = key;
    void loadProtocol();
  }, [identity, loadProtocol, realtime.latestBlockNumber, realtime.status, walletAddress]);

  if (!ready || !walletState.ready) {
    if (walletTimedOut) {
      return (
        <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <span className="text-[12px] text-warn">Wallet provider is unavailable.</span>
          <button type="button" aria-label="Retry wallet provider" onClick={() => window.location.reload()} className="glass-press ml-auto flex min-h-11 min-w-11 items-center justify-center rounded-xl text-mut"><RefreshCw className="h-4 w-4" aria-hidden="true" /></button>
        </div>
      );
    }
    return <PortfolioLoading />;
  }

  if (!authenticated || !wallet) {
    return <DisconnectedPortfolio authenticated={authenticated} />;
  }

  const loading = walletBalances.status === 'idle' || walletBalances.status === 'loading';
  const liveLoading = liveAssets.status === 'idle' || liveAssets.status === 'loading';
  const fxSaveLoading = fxSaveSnapshot.status === 'idle' || fxSaveSnapshot.status === 'loading';
  const failedReads = walletBalances.status === 'unavailable'
    || Boolean(walletBalances.data?.failedTokens.length)
    || fxSaveSnapshot.status === 'partial'
    || fxSaveSnapshot.status === 'unavailable';
  const hasVerifiedReads = walletBalances.data !== null
    || fxSaveSnapshot.status === 'ready'
    || fxSaveSnapshot.status === 'partial';
  const protocol: ProtocolSnapshot = {
    ...fxSaveSnapshot,
    claimable: claimableQuery.status === 'ready' ? claimableQuery.data : null,
    balances: walletBalances.data,
    status: failedReads
      ? hasVerifiedReads ? 'partial' : 'unavailable'
      : loading || fxSaveLoading ? 'loading' : 'ready',
  };
  const refreshing = manualRefresh.refreshing || priceSnapshot.refreshing || walletBalances.isFetching || liveAssets.isFetching || claimableQuery.isFetching || fxSaveLoading || (fxSaveRefreshing.identity === identity && fxSaveRefreshing.active) || positionState.refreshing;
  const fallbackValuation = walletValuation(protocol.balances, displayPrices, liveAssets.status === 'ready');
  const valuationNow = Date.now();
  const displayAssets = liveAssets.data
    ? mergeFreshCanonicalWalletBalances(liveAssets.data, walletBalances.data, walletBalances.updatedAt, priceSnapshot, valuationNow)
    : canonicalWalletBalancesSnapshot(wallet.address, walletBalances.data, walletBalances.updatedAt, priceSnapshot, liveAssets.status === 'unavailable' ? 'unavailable' : 'pending', valuationNow);
  const valuation = displayAssets ? walletAssetValuation(displayAssets) : fallbackValuation;
  const pricedWalletRows = displayAssets?.assets.filter((asset) => asset.balanceWei > 0n && asset.usdValue !== null && asset.priceStatus === 'fresh') ?? [];
  const allWalletRowsPriced = displayAssets
    ? pricedWalletRows.length === displayAssets.assets.filter((asset) => asset.balanceWei > 0n).length
    : true;
  const knownWalletSubtotal = knownFreshPortfolioSubtotal(displayAssets, walletBalances.data, walletBalances.updatedAt, priceSnapshot, valuationNow);
  const positionValues = positionState.positions.map((position) =>
    positionIsStale(position, positionState.failedGroups)
      ? null : positionNetEquityUsd(position, displayPrices));
  const missingPositions = positionValues.filter((value) => value === null).length;
  const protocolEquityUsd = positionValues.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const knownPositionCount = positionValues.filter((value) => value !== null).length;
  const positionsComplete = positionState.status === 'ready'
    && positionState.pendingPositions.length === 0 && missingPositions === 0;
  const portfolioComplete = valuation.complete && allWalletRowsPriced && positionsComplete;
  const portfolioValuation = {
    ...valuation,
    complete: portfolioComplete,
    totalUsd: portfolioComplete && valuation.totalUsd !== null
      ? valuation.totalUsd + protocolEquityUsd : null,
    reason: '',
  };
  const walletTasks = selectWalletTasks({ walletAddress: wallet.address, transactions: [], claimable: protocol.claimable,
    valuation: (!valuation.complete || !allWalletRowsPriced) && Boolean(displayAssets?.assets.some((asset) => asset.balanceWei > 0n))
      ? knownWalletSubtotal.hasKnownValue ? 'partial' : 'unavailable' : 'complete' });

  const refreshAll = () => {
    haptic('light');
    void manualRefresh.run([priceSnapshot.refresh, liveAssets.refresh, walletBalances.refresh, claimableQuery.refresh, loadProtocol, positionState.refresh]);
  };
  return <div id="overview" className={presentation.dashboard}>
    <div className={presentation.primary}>
      <SupportedValueCard displayTotalUsd={portfolioValuation.totalUsd}
        loading={loading || liveLoading || priceSnapshot.refreshing || positionState.refreshing} refreshing={manualRefresh.refreshing} onRefresh={refreshAll}
        walletValue={knownWalletSubtotal.totalUsd} positionEquity={positionsComplete || knownPositionCount > 0 ? protocolEquityUsd : null}
        walletComplete={valuation.complete && allWalletRowsPriced} positionsComplete={positionsComplete} assetCount={valuation.assetCount} />
      <QuickActions />
      {walletTasks.filter((task) => task.kind !== 'transaction' && (task.kind !== 'valuation' || !refreshing)).map((task) => <StatusNotice key={task.id} title={task.title}
        tone={task.state === 'ready' ? 'success' : 'neutral'} action={<Link href={task.href}>{task.kind === 'withdrawal' && task.state === 'ready' ? 'Review claim' : task.kind === 'valuation' ? 'View affected assets' : 'View details'}</Link>}>
        {task.kind !== 'valuation' && task.detail}
      </StatusNotice>)}
      <PortfolioAssets snapshot={displayAssets} loading={loading || liveLoading}
        network={network} onNetworkChange={setNetwork} />
      <section aria-labelledby="portfolio-positions-heading" className={presentation.positionsSection}>
        <div className={presentation.sectionTitle}><h2 id="portfolio-positions-heading">Positions</h2>
          {positionState.positions.length > 0 && <Link href="/positions">Manage all <ChevronRight size={15} aria-hidden="true" /></Link>}</div>
        <ProtocolPositionNotice status={positionState.status} failedGroups={positionState.failedGroups}
          hasPositions={positionState.positions.length + positionState.pendingPositions.length > 0} refreshing={positionState.refreshing}
          onRefresh={() => void positionState.refresh()} compact />
        <ConfirmedPositionCards />
        {positionState.status === 'loading' && !positionState.positions.length && !positionState.pendingPositions.length ? <ProtocolPositionSkeleton compact />
          : positionState.positions.length > 0 ? <div className={presentation.positionList}>{positionState.positions.slice(0, 2).map((position) => {
            const key = encodeURIComponent(`${position.market}:${position.side}:${position.info.positionId}`);
            return <div key={key} className={presentation.positionItem}><ProtocolPositionCard position={position} compact />
              <div className={presentation.positionActions} role="group" aria-label={`Actions for ${position.market} ${position.side} position ${position.info.positionId}`}>
                <Link href={`/positions?position=${key}`}>Manage</Link>
                {position.side === 'long' && <Link href={`/borrow?market=${position.market}&position=${position.info.positionId}`}>Borrow</Link>}
                <Link href={`/positions?position=${key}&action=close`}>Close</Link>
              </div>
            </div>;
          })}</div> : positionState.status === 'ready' && !positionState.pendingPositions.length ? <p className={presentation.emptyState}>No open positions. <Link href="/trade">Open trade</Link></p> : null}
      </section>
      <EarnPositionCard protocol={protocol} loading={fxSaveLoading} prices={displayPrices} />
    </div>
    <aside className={presentation.secondary}>
      <RecentActivityPreview walletAddress={wallet.address as Address} />
      <MarketOverview />
      <RowGroup title="Protocol tools"><ActionRow icon={CircleDollarSign} title="Borrow fxUSD" description="Manage collateral and debt" href="/borrow" /></RowGroup>
    </aside>
  </div>;
}

function DisconnectedPortfolio({ authenticated }: { authenticated: boolean }) {
  return (
    <div id="overview" className={`${styles.overview} ${styles.disconnectedOverview}`}>
      <div className={`${styles.primaryColumn} col-span-full`}>
        <ConnectWalletButton className="button button-primary glass-press flex min-h-11 w-full max-w-[320px] self-center items-center justify-center gap-2 rounded-xl px-4 py-3 text-[13px] font-semibold">
          {authenticated ? 'Choose wallet' : 'Connect wallet'}
        </ConnectWalletButton>
        <QuickActions />
        <MarketOverview />
      </div>
    </div>
  );
}

function EarnPositionCard({ protocol, loading, prices }: { protocol: ProtocolSnapshot; loading: boolean; prices: UsdPriceMap }) {
  const hasBalance = protocol.fxSaveShares !== null;
  if (loading && !hasBalance) return <ProductSurface><span role="status" className="skeleton block h-16 w-full rounded-xl" aria-label="Loading fxSAVE position" /></ProductSurface>;
  if (!hasBalance) return <ActionRow icon={PiggyBank} title="fxSAVE" href="/earn" value="View Earn" />;
  if (!/[1-9]/.test(protocol.fxSaveShares!) && claimAvailability(protocol.claimable).status !== 'ready') return <section aria-labelledby="portfolio-earn-heading" className={presentation.emptyEarn}>
    <div className={presentation.sectionTitle}><h2 id="portfolio-earn-heading">Earn position</h2><Link href="/earn">Manage <ChevronRight size={15} aria-hidden="true" /></Link></div>
    <p><span>fxSAVE</span><strong>0 fxSAVE</strong><Link href="/earn?mode=deposit">Deposit</Link></p>
  </section>;
  const value = fxSaveUsdValue('assetsWei', protocol.fxSaveAssets, prices);
  return <section aria-labelledby="portfolio-earn-heading" className={presentation.earnSection}>
    <div className={presentation.sectionTitle}><h2 id="portfolio-earn-heading">Earn position</h2><Link href="/earn">Manage <ChevronRight size={15} aria-hidden="true" /></Link></div>
    <ProductSurface className={presentation.earnCard}>
      <div className={presentation.earnTop}><TokenIcon symbol="fxSAVE" size={36} /><div><h3>fxSAVE</h3><p>{formatExactDecimal(protocol.fxSaveShares!, 6)} fxSAVE</p></div>
        <strong><ValueOrSkeleton value={formatUsd(value)} width="md" status="unavailable" label="fxSAVE position value" /></strong></div>
      <div className={presentation.earnActions}><Link href="/earn?mode=deposit">Deposit</Link><Link href="/earn?mode=withdraw">Withdraw</Link>
        {claimAvailability(protocol.claimable).status === 'ready' && <Link href="/earn?mode=claim">Review claim</Link>}</div>
      <Disclosure title="Underlying holdings"><p className={presentation.helper}><ValueOrSkeleton value={protocol.fxSaveAssets === null ? '—' : `${formatExactDecimal(protocol.fxSaveAssets, 6)} fxUSD base-pool shares`} status={loading ? 'loading' : 'unavailable'} label="Underlying holdings" /></p></Disclosure>
    </ProductSurface>
  </section>;
}

function SupportedValueCard({ displayTotalUsd, loading, refreshing, onRefresh,
  walletValue, positionEquity, walletComplete, positionsComplete, assetCount,
}: {
  displayTotalUsd: number | null; loading: boolean; refreshing: boolean; onRefresh: () => void;
  walletValue: number | null; positionEquity: number | null; walletComplete: boolean; positionsComplete: boolean; assetCount: number;
}) {
  return <ProductSurface className={presentation.valueCard}>
    <div className={presentation.valueTop}><span>Portfolio value</span><div>
      <button type="button" aria-label="Refresh portfolio balances and positions" aria-busy={refreshing} title="Refresh balances and positions" disabled={refreshing} onClick={onRefresh}>
        <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
      </button>
    </div></div>
    <p className={presentation.valueNumber} data-portfolio-value><ValueOrSkeleton value={displayTotalUsd === null ? '—' : formatUsd(displayTotalUsd)} width="xl"
      status={loading ? 'loading' : 'unavailable'} label={loading ? 'Loading portfolio value' : 'Portfolio value unavailable'} /></p>
    <p className={presentation.valueCaption}><ValueOrSkeleton value={walletComplete ? `${assetCount} ${assetCount === 1 ? 'wallet asset' : 'wallet assets'}` : '—'} width="sm" status={loading ? 'loading' : 'unavailable'} label="Wallet asset count" /></p>
    <Disclosure title="Value breakdown">
      <MetricRows rows={[
        { label: walletComplete ? 'Wallet assets' : 'Known wallet assets', value: formatUsd(walletValue) },
  { label: positionsComplete ? 'Position value' : 'Known position value', value: formatUsd(positionEquity) },
      ]} />
      <p className={presentation.helper}>Position value is collateral minus debt. Pending transfers and withdrawal claims are excluded.</p>
    </Disclosure>
  </ProductSurface>;
}

function QuickActions() {
  const actions: { href: string; label: string; icon: LucideIcon }[] = [
    { href: '/qr', label: 'Receive', icon: ArrowDownToLine },
    { href: '/trade', label: 'Trade', icon: CandlestickChart },
    { href: '/move', label: 'Move', icon: ArrowLeftRight },
    { href: '/earn', label: 'Earn', icon: PiggyBank },
  ];
  return (
    <section aria-labelledby="portfolio-actions-title">
      <h2 id="portfolio-actions-title" className="sr-only">Actions</h2>
      <div className={presentation.quickActions}>
        {actions.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} onClick={() => haptic('light')} className={presentation.quickAction}>
            <span><Icon className="h-5 w-5" aria-hidden="true" /></span>
            <strong>{label}</strong>
          </Link>
        ))}
      </div>
    </section>
  );
}

function MarketOverview() {
  return (
    <section aria-labelledby="market-overview-title">
      <SectionTitle right={<Link href="/trade" className="glass-press flex min-h-11 items-center gap-1 px-1 text-[11px] font-semibold text-mint">Open trade <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>}>
        <span id="market-overview-title">Markets</span>
      </SectionTitle>
      <div className={`${styles.market} grid grid-cols-2 gap-2.5`}>
        <MarketMiniCard market="ETH" />
        <MarketMiniCard market="BTC" />
      </div>
    </section>
  );
}

function PortfolioLoading() {
  return (
    <div id="overview" role="status" aria-label="Loading portfolio" className={`${styles.workspace} space-y-3`}>
      <div className={styles.loadingCard}><span className="sr-only">Loading wallet</span></div>
      <div className={styles.loadingActions}><span /><span /><span /><span /></div>
    </div>
  );
}

type FxSaveSnapshot = {
  status: 'idle' | 'loading' | 'ready' | 'partial' | 'unavailable';
  fxSaveShares: string | null;
  fxSaveAssets: string | null;
  claimable: ClaimableLike | null;
};

type ProtocolSnapshot = FxSaveSnapshot & { balances: WalletBalancesResult | null };

type WalletValuation = {
  complete: boolean;
  totalUsd: number | null;
  knownSubtotalUsd: number | null;
  knownAssetCount: number;
  assetCount: number;
  reason: string;
};

function walletValuation(balances: WalletBalancesResult | null, prices: UsdPriceMap, completeAllowed = true): WalletValuation {
  if (!balances) return { complete: false, totalUsd: null, knownSubtotalUsd: null, knownAssetCount: 0, assetCount: 0, reason: '' };
  const nonZero = balances.balances.filter((balance) => balance.amountWei > 0n);
  const values = nonZero.map((balance) => {
    const key = priceKeyForSymbol(balance.key);
    return usdValueForUnits(balance.amountWei, balance.decimals, key ? prices[key] : undefined);
  });
  const pricedValues = values.filter((value): value is number => value !== null);
  const unpricedCount = values.length - pricedValues.length;
  const failedCount = balances.failedTokens.length;
  const missingCount = unpricedCount + failedCount;
  if (missingCount > 0) {
    return {
      complete: false,
      totalUsd: null,
      knownSubtotalUsd: pricedValues.length > 0 ? pricedValues.reduce((total, value) => total + value, 0) : null,
      knownAssetCount: pricedValues.length,
      assetCount: nonZero.length,
      reason: '',
    };
  }
  if (!completeAllowed) {
    return {
      complete: false,
      totalUsd: null,
      knownSubtotalUsd: pricedValues.length > 0 ? pricedValues.reduce((total, value) => total + value, 0) : null,
      knownAssetCount: pricedValues.length,
      assetCount: nonZero.length,
      reason: '',
    };
  }
  return {
    complete: true,
    totalUsd: values.reduce<number>((total, value) => total + (value ?? 0), 0),
    knownSubtotalUsd: values.reduce<number>((total, value) => total + (value ?? 0), 0),
    knownAssetCount: pricedValues.length,
    assetCount: nonZero.length,
    reason: '',
  };
}

function positionNetEquityUsd(position: UiPosition, prices: UsdPriceMap): number | null {
  const collateralKey = priceKeyForSymbol(position.info.rawCollsToken);
  const debtKey = priceKeyForSymbol(position.info.rawDebtsToken);
  const valuation = calculatePositionUsdValuation({
    collateralRaw: position.info.rawColls,
    collateralDecimals: positionTokenDecimals(position, 'collateral'),
    collateralPrice: collateralKey ? prices[collateralKey] : undefined,
    debtRaw: position.info.rawDebts,
    debtDecimals: positionTokenDecimals(position, 'debt'),
    debtPrice: debtKey ? prices[debtKey] : undefined,
  });
  if (valuation.netEquityUsdCents === null) return null;
  const value = Number(valuation.netEquityUsdCents) / 100;
  return Number.isFinite(value) ? value : null;
}

function formatProtocolAmount(value: bigint): string {
  const formatted = formatUnits(value, 18).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return formatted || '0';
}
