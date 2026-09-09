'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  CandlestickChart,
  ChevronRight,
  CircleDollarSign,
  Coins,
  Layers2,
  PiggyBank,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { formatUnits, type Address } from 'viem';
import { MarketMiniCard } from '@/components/MarketChart';
import { useUsdPrices } from '@/components/PriceProvider';
import { useWalletBalances } from '@/components/WalletDataProvider';
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
import { tokenSymbol } from '@/lib/fx/tokenPresentation';
import { AddressChip, AppShell, Card, SectionTitle } from '@/components/ui';
import {
  assertConfiguredPublicClientChain,
  getFxReadFacade,
  withReadDeadline,
  type WalletBalancesResult,
  type WalletTokenBalance,
} from '@/lib/fx';
import { positionTokenDecimals, type UiPosition } from '@/app/trade/fxUi';
import { formatUsd, priceKeyForSymbol, usdValueForUnits, type UsdPriceMap } from '@/lib/prices';
import { walletAssetValuation } from '@/lib/walletAssets';
import { calculatePositionUsdValuation } from '@/lib/positionValuation';
import { fxSaveUsdValue } from '@/lib/fxSaveUnits';
import { haptic } from '@/lib/telegram';
import { usePrivyWallet, useWalletReadyTimeout } from '@/lib/wallet';
import styles from '@/app/AccountWorkspace.module.css';
import ConnectWalletButton from '@/components/ConnectWalletButton';
import { displayAssetSymbol, PortfolioAssets, PortfolioNetworkTabs, type PortfolioNetwork } from '@/components/PortfolioAssets';

const EMPTY_FX_SAVE: FxSaveSnapshot = {
  status: 'idle',
  fxSaveShares: null,
  fxSaveAssets: null,
  redeemReady: null,
};

/**
 * Portfolio deliberately reports only state that FxAeon can verify. Wallet
 * value is the sum of fresh wallet balances plus verified protocol equity. A
 * partial total remains useful when one asset is unpriced, and the card calls
 * that out without presenting an estimate as a verified complete total.
 */
export default function PortfolioPage() {
  return (
    <AppShell tabs>
      <div className={`${styles.workspace} portfolio-dashboard stagger flex flex-col`}>
        <header className={`${styles.heading} portfolio-page-heading`}>
          <div>
            <h1 className="text-display mt-1.5 text-[30px] font-semibold leading-tight">Portfolio</h1>
          </div>
        </header>

        <nav className={`${styles.tabs} portfolio-context-tabs`} aria-label="Portfolio sections">
          <a href="#overview" aria-current="page">Overview</a>
          <Link href="/positions">Positions</Link>
          <Link href="/earn">Earn</Link>
        </nav>

        <PortfolioWallet />
      </div>
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
  const walletAddress = authenticated && ready && walletState.ready ? wallet?.address : undefined;
  const identity = walletAddress?.toLowerCase() ?? '';
  const walletBalances = useWalletBalances({ address: walletAddress, chainId: 1, enabled: Boolean(walletAddress) });
  const liveAssets = useWalletAssets({ address: walletAddress, enabled: Boolean(walletAddress) });
  const [network, setNetwork] = useState<PortfolioNetwork>('all');
  const [fxSaveState, setFxSaveState] = useState<{ identity: string; snapshot: FxSaveSnapshot }>({ identity: '', snapshot: EMPTY_FX_SAVE });
  const fxSaveSnapshot = fxSaveState.identity === identity ? fxSaveState.snapshot : EMPTY_FX_SAVE;
  const requestId = useRef(0);
  const realtime = useRealtimeChainState(1) as import('@/lib/realtimeChain').RealtimeChainState;
  const protocolBlockRef = useRef('');

  const loadProtocol = useCallback(async () => {
    if (!walletAddress) return;
    const activeRequest = ++requestId.current;
    setFxSaveState({ identity, snapshot: { ...EMPTY_FX_SAVE, status: 'loading' } });
    try {
      await withReadDeadline(assertConfiguredPublicClientChain(1));
      if (requestId.current !== activeRequest) return;
      const sdk = getFxReadFacade();
      const [fxSave, redeem] = await Promise.allSettled([
        sdk.getFxSaveBalance({ userAddress: walletAddress }),
        sdk.getFxSaveClaimable({ userAddress: walletAddress }),
      ]);
      if (requestId.current !== activeRequest) return;

      const fulfilled = [fxSave, redeem].filter((result) => result.status === 'fulfilled').length;
      setFxSaveState({
        identity,
        snapshot: {
          status: fulfilled === 2 ? 'ready' : fulfilled > 0 ? 'partial' : 'unavailable',
          fxSaveShares: fxSave.status === 'fulfilled' ? formatProtocolAmount(fxSave.value.balanceWei) : null,
          fxSaveAssets: fxSave.status === 'fulfilled' && fxSave.value.assetsWei !== undefined
            ? formatProtocolAmount(fxSave.value.assetsWei)
            : null,
          redeemReady: redeem.status === 'fulfilled' ? redeem.value.isCooldownComplete : null,
        },
      });
    } catch {
      if (requestId.current === activeRequest) {
        setFxSaveState({ identity, snapshot: { ...EMPTY_FX_SAVE, status: 'unavailable' } });
      }
    }
  }, [identity, walletAddress]);

  useEffect(() => {
    if (walletAddress) void loadProtocol();
    return () => { requestId.current += 1; };
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
    balances: walletBalances.data,
    status: failedReads
      ? hasVerifiedReads ? 'partial' : 'unavailable'
      : loading || fxSaveLoading ? 'loading' : 'ready',
  };
  const refreshing = walletBalances.isFetching || fxSaveLoading || positionState.refreshing;
  const valuation = liveAssets.data
    ? walletAssetValuation(liveAssets.data)
    : walletValuation(protocol.balances, priceSnapshot.prices, liveAssets.status === 'ready');
  const positionValues = positionState.positions.map((position) =>
    positionIsStale(position, positionState.failedGroups) || priceSnapshot.status === 'stale'
      ? null : positionNetEquityUsd(position, priceSnapshot.prices));
  const missingPositions = positionValues.filter((value) => value === null).length;
  const protocolEquityUsd = positionValues.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const portfolioValuation = valuation.totalUsd === null
    ? valuation
    : { ...valuation, totalUsd: valuation.totalUsd + protocolEquityUsd,
      complete: valuation.complete && missingPositions === 0,
      reason: valuation.reason };

  return (
      <div id="overview" className={styles.overview}>
      <div className={styles.primaryColumn}>
        <RecentActivityPreview walletAddress={wallet.address as Address} />
        <SupportedValueCard
        walletAddress={wallet.address}
        protocol={protocol}
        valuation={portfolioValuation}
        loading={loading || liveLoading}
        fxSaveLoading={fxSaveLoading}
        refreshing={refreshing}
        onRefresh={() => {
          haptic('light');
          void Promise.allSettled([liveAssets.refresh(), walletBalances.refresh(), loadProtocol(), positionState.refresh()]);
        }}
        positionValue={positionState.pendingPositions.length > 0
          ? '…'
          : positionState.status === 'idle' || positionState.status === 'loading'
          ? '…'
          : positionState.status === 'ready'
            ? String(positionState.positions.length)
              : positionState.status === 'partial' && positionState.positions.length > 0
              ? String(positionState.positions.length)
              : positionState.status === 'unavailable' && positionState.lastVerifiedAt !== null
                ? `${positionState.positions.length} last`
                : '—'}
        />

        <QuickActions />
        <MarketOverview />

        <section className={styles.portfolioPositionsSection} aria-labelledby="portfolio-positions-heading">
        <SectionTitle right={<Link href="/trade" className="glass-press flex min-h-11 items-center gap-1 px-1 text-[11px] font-semibold text-mint">Open trade <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>}><span id="portfolio-positions-heading">Positions</span></SectionTitle>
        <div className="flex flex-col gap-2.5">
          <ProtocolPositionNotice status={positionState.status} failedGroups={positionState.failedGroups} hasPositions={positionState.positions.length + positionState.pendingPositions.length > 0} refreshing={positionState.refreshing} onRefresh={() => void positionState.refresh()} compact />
          <ConfirmedPositionCards />
          {positionState.status === 'loading' && !positionState.positions.length && !positionState.pendingPositions.length ? <ProtocolPositionSkeleton compact /> : positionState.positions.length > 0 ? (
            positionState.positions.slice(0, 2).map((position) => {
              const key = encodeURIComponent(`${position.market}:${position.side}:${position.info.positionId}`);
              const manageHref = `/positions?position=${key}`;
              return (
                <div key={`${position.market}:${position.side}:${position.info.positionId}`} className={styles.portfolioPositionItem}>
                  <ProtocolPositionCard position={position} compact />
                  <div role="group" className={styles.portfolioPositionActions} aria-label={`Actions for ${position.market} ${position.side} position ${position.info.positionId}`}>
                    <Link href={manageHref} className="glass-press">Manage</Link>
                    {position.side === 'long' && <Link href={`/borrow?market=${position.market}&position=${position.info.positionId}`} className="glass-press">Borrow</Link>}
                    <Link href={`/positions?position=${key}&action=close`} className="glass-press">Close</Link>
                  </div>
                </div>
              );
            })
          ) : positionState.status === 'ready' && !positionState.pendingPositions.length ? (
            <ProtocolCard icon={Layers2} label="Positions" value="0 open" hint="Open an ETH or BTC position" href="/trade" />
          ) : null}
        </div>
        </section>

        <EarnPositionCard protocol={protocol} loading={fxSaveLoading} prices={priceSnapshot.prices} />
      </div>

      <aside className={styles.secondaryColumn}>
        <SectionTitle>Protocol tools</SectionTitle>
        <div className={styles.protocolTools}>
          <ProtocolCard
            icon={PiggyBank}
            label="fxSAVE"
            value={fxSaveLabel(protocol, priceSnapshot.prices)}
            hint={protocol.redeemReady ? 'Withdrawal ready to claim' : 'Save, request, and claim'}
            href="/earn"
            accent={protocol.redeemReady === true}
          />
          <ProtocolCard
            icon={CircleDollarSign}
            label="Borrow fxUSD"
            value="Mint fxUSD"
            hint="Collateral-backed borrowing"
            href="/borrow"
          />
        </div>

        <PortfolioNetworkTabs value={network} onChange={setNetwork} />
        <PortfolioAssets snapshot={liveAssets.data} loading={liveLoading} status={liveAssets.status} onRetry={() => void liveAssets.refresh()} network={network} />
        {!liveAssets.data && <WalletBalancesCard balances={protocol.balances} loading={loading || liveLoading} prices={priceSnapshot.prices} completeAllowed={liveAssets.status === 'ready'} />}
      </aside>
    </div>
  );
}

function DisconnectedPortfolio({ authenticated }: { authenticated: boolean }) {
  return (
    <div id="overview" className={`${styles.overview} ${styles.disconnectedOverview}`}>
      <div className={styles.primaryColumn}>
        <Card glow elevation={2} className={`${styles.valueCard} ${styles.disconnectedValueCard} relative overflow-hidden p-5`}>
          <div className={styles.valueMain}>
            <div>
              <p className={`${styles.valueAmount} text-display text-[38px] font-semibold leading-none tabular-nums`}>—</p>
            </div>
            <ConnectWalletButton className="button button-primary glass-press flex min-h-11 w-full max-w-[190px] items-center justify-center gap-2 rounded-xl px-3 py-2 text-[12px] font-semibold">
              {authenticated ? 'Choose wallet' : 'Connect wallet'}
            </ConnectWalletButton>
          </div>
        </Card>

        <QuickActions />
        <MarketOverview />
      </div>

    </div>
  );
}

function EarnPositionCard({ protocol, loading, prices }: { protocol: ProtocolSnapshot; loading: boolean; prices: UsdPriceMap }) {
  const hasPosition = protocol.fxSaveShares !== null || protocol.fxSaveAssets !== null;
  if (!loading && !hasPosition) return null;
  const usd = fxSaveUsdValue('assetsWei', protocol.fxSaveAssets, prices);
  return (
    <section className={styles.portfolioEarnSection} aria-labelledby="portfolio-earn-heading">
      <SectionTitle right={<Link href="/earn" className="glass-press flex min-h-11 items-center gap-1 px-1 text-[11px] font-semibold text-mint">Open Earn <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>}><span id="portfolio-earn-heading">Earn position</span></SectionTitle>
      <Card className={styles.portfolioEarnCard}>
        {loading ? <div role="status" aria-label="Loading fxSAVE position" className={styles.portfolioEarnSkeleton}><span className="skeleton h-5 w-28 rounded" /><span className="skeleton h-8 w-44 rounded" /><span className="skeleton h-3 w-32 rounded" /></div> : <>
          <div className={styles.portfolioEarnTopline}><div><p className="text-[13px] text-mut">fxSAVE</p><strong className="text-display text-[24px] font-semibold tabular-nums">{protocol.fxSaveShares ?? '0'} fxSAVE</strong></div><PiggyBank className="h-6 w-6 text-mint" aria-hidden="true" /></div>
          <div className={styles.portfolioEarnMetrics}><span><small>Value</small><strong>{usd === null ? '—' : formatUsd(usd)}</strong></span><span><small>Underlying</small><strong>{protocol.fxSaveAssets ?? '—'} fxUSD</strong></span></div>
          <div role="group" className={styles.portfolioEarnActions} aria-label="fxSAVE actions"><Link href="/earn?mode=deposit" className="glass-press">Deposit</Link><Link href="/earn?mode=withdraw" className="glass-press">Withdraw</Link><Link href="/earn?mode=claim" className="glass-press">Claim</Link></div>
        </>}
      </Card>
    </section>
  );
}

function SupportedValueCard({
  walletAddress,
  protocol,
  valuation,
  loading,
  fxSaveLoading,
  refreshing,
  onRefresh,
  positionValue,
}: {
  walletAddress: string;
  protocol: ProtocolSnapshot;
  valuation: WalletValuation;
  loading: boolean;
  fxSaveLoading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  positionValue: string;
}) {
  const supportedAssetValue = loading && valuation.assetCount === 0 ? '—' : String(valuation.assetCount);

  return (
    <Card glow elevation={2} className={`${styles.valueCard} relative overflow-hidden p-5`}>
      <div className={styles.valueTopline}>
        <div>
          <div className="mt-2"><AddressChip address={walletAddress} /></div>
        </div>
        <button type="button" aria-label="Refresh portfolio" onClick={onRefresh} disabled={refreshing} className="glass-press flex min-h-11 min-w-11 items-center justify-center rounded-xl text-mut hover:text-mint disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      </div>

      <div className={styles.valueMain}>
        <div>
          <p className={`${styles.valueAmount} text-display text-[38px] font-semibold leading-none tabular-nums`}>
            {loading ? '—' : valuation.totalUsd === null ? '—' : formatUsd(valuation.totalUsd)}
          </p>
          <p className={`${styles.valueHint} mt-2 text-[11px] text-mut`} aria-live="polite">
            {loading
              ? <span className="skeleton inline-block h-3 w-28 align-middle" aria-label="Loading portfolio value" />
              : !valuation.complete
                ? <span className="text-warn">{protocol.status === 'unavailable' ? 'Portfolio value unavailable' : 'Partial value · verify reads'}</span>
                : `${valuation.assetCount} ${valuation.assetCount === 1 ? 'asset' : 'assets'}`}
          </p>
        </div>
      </div>

      <div className={`${styles.valueMetrics} portfolio-value-metrics`}>
        <ValueMetric label="Open positions" value={positionValue} />
        <ValueMetric label="fxSAVE" value={protocol.fxSaveShares !== null ? `${protocol.fxSaveShares} fxSAVE` : fxSaveLoading ? '…' : '—'} />
        <ValueMetric label="Assets" value={supportedAssetValue} />
      </div>
    </Card>
  );
}

function ValueMetric({ label, value }: { label: string; value: string }) {
  return <span><small>{label}</small><strong>{value}</strong></span>;
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
      <SectionTitle><span id="portfolio-actions-title">Actions</span></SectionTitle>
      <div className={styles.actions}>
        {actions.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} onClick={() => haptic('light')} className={`${styles.action} glass glass-press`}>
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

function ProtocolCard({ icon: Icon, label, value, hint, href, accent = false }: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  href: string;
  accent?: boolean;
}) {
  return (
    <Link href={href} onClick={() => haptic('light')} className={`${styles.protocolCard} ${accent ? styles.protocolCardAccent : ''} glass glass-press`}>
      <span><Icon className="h-5 w-5" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{hint}</em>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-mut" aria-hidden="true" />
    </Link>
  );
}

function WalletBalancesCard({ balances, loading, prices, completeAllowed }: { balances: WalletBalancesResult | null; loading: boolean; prices: UsdPriceMap; completeAllowed: boolean }) {
  const nonZero = balances?.balances.filter((balance) => balance.amountWei > 0n) ?? [];
  const valuation = walletValuation(balances, prices, completeAllowed);
  const assetCountLabel = loading || balances === null
    ? '—'
    : `${nonZero.length} ${nonZero.length === 1 ? 'asset' : 'assets'}`;

  return (
    <section aria-labelledby="wallet-balances-title">
      <SectionTitle><span id="wallet-balances-title">Assets</span></SectionTitle>
      <Card className={`${styles.balanceCard} relative overflow-hidden p-0`}>
        <div className={`${styles.balanceHeader} flex min-h-[60px] items-center justify-end gap-3 border-b border-[var(--line)] px-4 py-3`}>
          <span className="text-right">
            <strong className="block text-[14px] tabular-nums">{loading ? '—' : valuation.complete ? formatUsd(valuation.totalUsd) : '—'}</strong>
            <span className="text-[9px] text-mut">{assetCountLabel}</span>
          </span>
        </div>

        {loading && <div className="m-4 h-24 animate-pulse rounded-xl bg-[var(--surface-2)]" role="status" aria-label="Loading wallet balances" />}
        {!loading && !balances && <div className="m-4 rounded-xl border border-[var(--line)] bg-[var(--warn-dim)] p-4 text-[12px] text-warn" role="status" aria-live="polite"><p>Wallet balances are unavailable.</p><p className="mt-1 text-mut">Retry the wallet read before relying on the total.</p></div>}
        {!loading && balances && nonZero.length === 0 && (
          <div className="flex items-center gap-3 px-4 py-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] text-mut"><Coins className="h-5 w-5" aria-hidden="true" /></span>
            <span><strong className="block text-[12.5px]">{balances.failedTokens.length > 0 ? 'Some asset balances are unavailable' : 'No supported assets found'}</strong>{balances.failedTokens.length === 0 ? <span className="mt-1 block text-[11px] text-mut">Receive a supported token to see it here.</span> : <span className="mt-1 block text-[11px] text-mut">The visible list is partial until the failed reads recover.</span>}</span>
          </div>
        )}
        {!loading && nonZero.length > 0 && (
          <div className={`${styles.balanceList} divide-y divide-[var(--line)] px-4`}>
            {nonZero.map((balance) => {
              const key = priceKeyForSymbol(balance.key);
              return <WalletBalanceRow key={balance.key} balance={balance} price={key ? prices[key] : undefined} />;
            })}
          </div>
        )}
      </Card>
    </section>
  );
}

function WalletBalanceRow({ balance, price }: { balance: WalletTokenBalance; price: number | undefined }) {
  const label = tokenSymbol(balance.key);
  return (
    <div className={`${styles.balanceRow} flex min-h-[68px] items-center justify-between gap-3 py-3`}>
      <div className="flex min-w-0 items-center gap-3">
        <TokenIcon symbol={balance.key} size={32} />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{label}</p>
          <p className="truncate text-[10px] text-mut">{balance.address.slice(0, 6)}…{balance.address.slice(-4)}</p>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-[12.5px] text-hi">{formatWalletAmount(balance)}</p>
        <p className="mt-0.5 text-[10.5px] text-mut">{formatUsd(usdValueForUnits(balance.amountWei, balance.decimals, price))}</p>
      </div>
    </div>
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
  redeemReady: boolean | null;
};

type ProtocolSnapshot = FxSaveSnapshot & { balances: WalletBalancesResult | null };

type WalletValuation = {
  complete: boolean;
  totalUsd: number | null;
  assetCount: number;
  reason: string;
};

function walletValuation(balances: WalletBalancesResult | null, prices: UsdPriceMap, completeAllowed = true): WalletValuation {
  if (!balances) return { complete: false, totalUsd: null, assetCount: 0, reason: '' };
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
      totalUsd: pricedValues.length > 0 ? pricedValues.reduce((total, value) => total + value, 0) : null,
      assetCount: nonZero.length,
      reason: `${missingCount} ${missingCount === 1 ? 'asset is' : 'assets are'} missing a verified value.`,
    };
  }
  if (!completeAllowed) {
    return {
      complete: false,
      totalUsd: values.length > 0 ? values.reduce<number>((total, value) => total + (value ?? 0), 0) : null,
      assetCount: nonZero.length,
      reason: 'Loading expanded wallet assets.',
    };
  }
  return {
    complete: true,
    totalUsd: values.reduce<number>((total, value) => total + (value ?? 0), 0),
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

function fxSaveLabel(protocol: ProtocolSnapshot, prices: UsdPriceMap): string {
  const units = protocol.fxSaveShares !== null
    ? `${protocol.fxSaveShares} fxSAVE`
    : protocol.fxSaveAssets !== null
      ? `${protocol.fxSaveAssets} fxSAVE`
      : null;
  if (units === null) return '—';
  const usdValue = fxSaveUsdValue('assetsWei', protocol.fxSaveAssets, prices);
  return `${units}${usdValue === null ? '' : ` · ${formatUsd(usdValue)} est.`}`;
}

function formatWalletAmount(balance: WalletTokenBalance): string {
  const value = formatUnits(balance.amountWei, balance.decimals);
  const [whole, fraction = ''] = value.split('.');
  const trimmed = fraction.slice(0, 8).replace(/0+$/, '');
  const label = displayAssetSymbol(balance.key);
  return trimmed ? `${whole}.${trimmed} ${label}` : `${whole} ${label}`;
}

function formatProtocolAmount(value: bigint): string {
  const formatted = formatUnits(value, 18).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return formatted || '0';
}
