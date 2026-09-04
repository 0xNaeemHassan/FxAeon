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
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { formatUnits, type Address } from 'viem';
import { MarketMiniCard } from '@/components/MarketChart';
import { useUsdPrices } from '@/components/PriceProvider';
import { useWalletBalances } from '@/components/WalletDataProvider';
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
import { AddressChip, AppShell, Card, EmptyState, SectionTitle } from '@/components/ui';
import {
  assertConfiguredPublicClientChain,
  getFxSdk,
  type WalletBalancesResult,
  type WalletTokenBalance,
} from '@/lib/fx';
import { formatUsd, priceKeyForSymbol, usdValueForUnits, type UsdPriceMap } from '@/lib/prices';
import { FX_SAVE_UNITS, fxSaveUsdValue } from '@/lib/fxSaveUnits';
import { haptic } from '@/lib/telegram';
import { usePrivyWallet, useWalletReadyTimeout } from '@/lib/wallet';
import styles from '@/app/AccountWorkspace.module.css';
import ConnectWalletButton from '@/components/ConnectWalletButton';

const EMPTY_FX_SAVE: FxSaveSnapshot = {
  status: 'idle',
  fxSaveShares: null,
  fxSaveAssets: null,
  redeemReady: null,
};

/**
 * Portfolio deliberately reports only state that FxAeon can verify. Wallet
 * value is the sum of supported Ethereum balances and is hidden whenever a
 * token read or a required USD price is missing. Positions and fxSAVE remain
 * separate protocol state so they cannot be accidentally double-counted.
 */
export default function PortfolioPage() {
  return (
    <AppShell tabs>
      <div className={`${styles.workspace} portfolio-dashboard stagger flex flex-col`}>
        <header className={`${styles.heading} portfolio-page-heading`}>
          <div>
            <p className={styles.eyebrow}>Overview / Ethereum</p>
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
  const [fxSaveState, setFxSaveState] = useState<{ identity: string; snapshot: FxSaveSnapshot }>({ identity: '', snapshot: EMPTY_FX_SAVE });
  const fxSaveSnapshot = fxSaveState.identity === identity ? fxSaveState.snapshot : EMPTY_FX_SAVE;
  const requestId = useRef(0);

  const loadProtocol = useCallback(async () => {
    if (!walletAddress) return;
    const activeRequest = ++requestId.current;
    setFxSaveState({ identity, snapshot: { ...EMPTY_FX_SAVE, status: 'loading' } });
    try {
      await assertConfiguredPublicClientChain(1);
      if (requestId.current !== activeRequest) return;
      const sdk = getFxSdk();
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

  if (!ready || !walletState.ready) {
    if (walletTimedOut) {
      return (
        <EmptyState
          icon={RefreshCw}
          title="Wallet did not load"
          body="Check your connection, update your browser or Telegram, then reopen FxAeon."
          action={<button type="button" onClick={() => window.location.reload()} className="button button-primary min-h-11 w-full rounded-xl px-4">Reload wallet</button>}
        />
      );
    }
    return <PortfolioLoading />;
  }

  if (!authenticated || !wallet) {
    return <DisconnectedPortfolio authenticated={authenticated} />;
  }

  const loading = walletBalances.status === 'idle' || walletBalances.status === 'loading';
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
  const valuation = walletValuation(protocol.balances, priceSnapshot.prices);

  return (
    <div id="overview" className={styles.overview}>
      <div className={styles.primaryColumn}>
        <SupportedValueCard
        walletAddress={wallet.address}
        protocol={protocol}
        valuation={valuation}
        loading={loading}
        fxSaveLoading={fxSaveLoading}
        refreshing={refreshing}
        onRefresh={() => {
          haptic('light');
          void Promise.allSettled([walletBalances.refresh(), loadProtocol(), positionState.refresh()]);
        }}
        positionValue={positionState.pendingPositions.length > 0
          ? `${positionState.positions.length + positionState.pendingPositions.length} updating`
          : positionState.status === 'idle' || positionState.status === 'loading'
          ? '…'
          : positionState.status === 'ready'
            ? String(positionState.positions.length)
            : positionState.status === 'partial' && positionState.positions.length > 0
              ? `${positionState.positions.length} shown`
              : positionState.status === 'unavailable' && positionState.lastVerifiedAt !== null
                ? `${positionState.positions.length} last`
                : '—'}
        />

        <QuickActions />
        <MarketOverview />

        <SectionTitle right={<Link href="/positions" className="glass-press flex min-h-11 items-center gap-1 px-1 text-[11px] font-semibold text-mint">{positionState.positions.length > 2 ? `View all ${positionState.positions.length}` : 'Manage positions'} <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>}>Protocol positions</SectionTitle>
        <div className="flex flex-col gap-2.5">
          <ProtocolPositionNotice status={positionState.status} failedGroups={positionState.failedGroups} hasPositions={positionState.positions.length + positionState.pendingPositions.length > 0} refreshing={positionState.refreshing} onRefresh={() => void positionState.refresh()} compact />
          <ConfirmedPositionCards />
          {positionState.status === 'loading' && !positionState.positions.length && !positionState.pendingPositions.length ? <ProtocolPositionSkeleton compact /> : positionState.positions.length > 0 ? (
            positionState.positions.slice(0, 2).map((position) => <ProtocolPositionCard key={`${position.market}:${position.side}:${position.info.positionId}`} position={position} compact href="/positions" stale={positionIsStale(position, positionState.failedGroups)} />)
          ) : positionState.status === 'ready' && !positionState.pendingPositions.length ? (
            <ProtocolCard icon={Layers2} label="Positions" value="0 open" hint="Open an ETH or BTC position" href="/trade" />
          ) : null}
        </div>
      </div>

      <aside className={styles.secondaryColumn}>
        <SectionTitle>Protocol tools</SectionTitle>
        <div className={styles.protocolTools}>
          <ProtocolCard
            icon={PiggyBank}
            label="fxSAVE"
            value={fxSaveLabel(protocol, priceSnapshot.prices, fxSaveLoading)}
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

      {(protocol.status === 'partial' || protocol.status === 'unavailable') && (
        <p role="status" className="mt-3 rounded-xl bg-[var(--warn-dim)] px-3 py-2.5 text-[11px] leading-relaxed text-warn">
          {protocol.status === 'partial'
            ? 'Some Ethereum reads are unavailable. FxAeon is showing only the state it could verify.'
            : 'Ethereum reads are unavailable right now. Your wallet remains connected; refresh to try again.'}
        </p>
      )}

        <WalletBalancesCard balances={protocol.balances} loading={loading} prices={priceSnapshot.prices} />
        <RecentActivityPreview walletAddress={wallet.address as Address} />
      </aside>
    </div>
  );
}

function DisconnectedPortfolio({ authenticated }: { authenticated: boolean }) {
  return (
    <div id="overview" className={styles.overview}>
      <div className={styles.primaryColumn}>
      <Card glow className={`${styles.connectCard} relative overflow-hidden p-5`}>
        <div className="relative">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 className="text-display mt-5 text-[23px] font-semibold">{authenticated ? 'Choose a wallet' : 'Your on-chain home'}</h2>
          <p className="mt-2 max-w-[390px] text-[12.5px] leading-relaxed text-mut">
            Connect to see supported wallet value, exact asset balances, positions, fxSAVE, and activity.
          </p>
          <ConnectWalletButton className="button button-primary glass-press mt-5 flex min-h-12 w-full max-w-[280px] items-center justify-center gap-2 rounded-xl px-4 py-3 text-[14px] font-semibold">
            {authenticated ? 'Choose wallet' : 'Connect wallet'}
          </ConnectWalletButton>
        </div>
      </Card>
      </div>
      <aside className={styles.secondaryColumn}>
        <QuickActions />
        <MarketOverview />
      </aside>
    </div>
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
  const supportedAssetValue = loading || protocol.balances === null
    ? '—'
    : String(valuation.assetCount);

  return (
    <Card glow elevation={2} className={`${styles.valueCard} relative overflow-hidden p-5`}>
      <div className={styles.valueTopline}>
        <div>
          <p className={styles.eyebrow}>Supported wallet value</p>
          <div className="mt-2"><AddressChip address={walletAddress} /></div>
        </div>
        <button type="button" aria-label="Refresh portfolio" onClick={onRefresh} disabled={refreshing} className="glass-press flex min-h-11 min-w-11 items-center justify-center rounded-xl text-mut hover:text-mint disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      </div>

      <div className={styles.valueMain}>
        <div>
          <p className={`${styles.valueAmount} text-display text-[38px] font-semibold leading-none tabular-nums`}>
            {loading ? '—' : valuation.complete ? formatUsd(valuation.totalUsd) : '—'}
          </p>
          <p className={`${styles.valueHint} mt-2 text-[11px] text-mut`}>
            {loading
              ? 'Reading supported Ethereum balances…'
              : valuation.complete
                ? `${valuation.assetCount} supported ${valuation.assetCount === 1 ? 'asset' : 'assets'}`
                : valuation.reason}
          </p>
        </div>
      </div>

      <div className={`${styles.valueMetrics} portfolio-value-metrics`}>
        <ValueMetric label="Open positions" value={positionValue} />
        <ValueMetric label="fxSAVE" value={protocol.fxSaveShares !== null ? `${protocol.fxSaveShares} fxSAVE` : fxSaveLoading ? '…' : '—'} />
        <ValueMetric label="Supported assets" value={supportedAssetValue} />
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

function WalletBalancesCard({ balances, loading, prices }: { balances: WalletBalancesResult | null; loading: boolean; prices: UsdPriceMap }) {
  const nonZero = balances?.balances.filter((balance) => balance.amountWei > 0n) ?? [];
  const valuation = walletValuation(balances, prices);
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
        {!loading && !balances && <p className="m-4 rounded-xl bg-[var(--warn-dim)] px-3 py-2 text-[11px] leading-relaxed text-warn">Supported token balances are unavailable. Refresh when Ethereum responds.</p>}
        {!loading && balances && nonZero.length === 0 && (
          <div className="flex items-center gap-3 px-4 py-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] text-mut"><Coins className="h-5 w-5" aria-hidden="true" /></span>
            <span><strong className="block text-[12.5px]">{balances.failedTokens.length > 0 ? 'No positive balances verified yet' : 'No supported assets found'}</strong><span className="mt-1 block text-[11px] text-mut">{balances.failedTokens.length > 0 ? 'Retry the unavailable asset reads before confirming this wallet is empty.' : 'Receive a supported token to see it here.'}</span></span>
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
        {!loading && balances && balances.failedTokens.length > 0 && (
          <p role="status" className="m-3 rounded-xl bg-[var(--warn-dim)] px-3 py-2 text-[11px] leading-relaxed text-warn">Some supported token reads failed, so the wallet total is hidden.</p>
        )}
      </Card>
    </section>
  );
}

function WalletBalanceRow({ balance, price }: { balance: WalletTokenBalance; price: number | undefined }) {
  const label = balance.key === 'fxUSDBasePool' ? 'fxUSD pool token' : balance.key;
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

function walletValuation(balances: WalletBalancesResult | null, prices: UsdPriceMap): WalletValuation {
  if (!balances) return { complete: false, totalUsd: null, assetCount: 0, reason: 'Wallet balances are not available yet.' };
  const nonZero = balances.balances.filter((balance) => balance.amountWei > 0n);
  if (balances.failedTokens.length > 0) {
    return { complete: false, totalUsd: null, assetCount: nonZero.length, reason: 'Some supported balances could not be verified.' };
  }
  const values = nonZero.map((balance) => {
    const key = priceKeyForSymbol(balance.key);
    return usdValueForUnits(balance.amountWei, balance.decimals, key ? prices[key] : undefined);
  });
  if (values.some((value) => value === null)) {
    return { complete: false, totalUsd: null, assetCount: nonZero.length, reason: 'A validated USD price is missing for a held asset.' };
  }
  return {
    complete: true,
    totalUsd: values.reduce<number>((total, value) => total + (value ?? 0), 0),
    assetCount: nonZero.length,
    reason: '',
  };
}

function fxSaveLabel(protocol: ProtocolSnapshot, prices: UsdPriceMap, loading: boolean): string {
  const units = protocol.fxSaveShares !== null
    ? `${protocol.fxSaveShares} ${FX_SAVE_UNITS.balanceWei.label}`
    : protocol.fxSaveAssets !== null
      ? `${protocol.fxSaveAssets} ${FX_SAVE_UNITS.assetsWei.label}`
      : null;
  if (units === null) return loading ? 'Loading…' : 'Unavailable';
  const usdValue = fxSaveUsdValue('assetsWei', protocol.fxSaveAssets, prices);
  return `${units}${usdValue === null ? '' : ` · ${formatUsd(usdValue)} est.`}`;
}

function formatWalletAmount(balance: WalletTokenBalance): string {
  const value = formatUnits(balance.amountWei, balance.decimals);
  const [whole, fraction = ''] = value.split('.');
  const trimmed = fraction.slice(0, 8).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed} ${balance.key}` : `${whole} ${balance.key}`;
}

function formatProtocolAmount(value: bigint): string {
  const formatted = formatUnits(value, 18).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return formatted || '0';
}
