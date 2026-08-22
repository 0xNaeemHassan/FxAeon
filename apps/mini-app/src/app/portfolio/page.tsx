'use client';

/**
 * Home — the user's real account state, served by the authenticated bot API.
 * No placeholder numbers: every value on this screen is read from the chain
 * or the bot's database, and every state has a next step.
 *
 * Layout matches the product's Portfolio mockup (Total Value hero · tabs ·
 * position cards · New Position). Where the mockup shows data the protocol
 * can't honestly provide yet (per-position price sparklines, an fxUSD
 * Stability-Pool position type), we substitute a real indicator or an honest
 * empty state rather than fabricate it.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  QrCode,
  CandlestickChart,
  ShieldCheck,
  RefreshCw,
  Send,
  PlugZap,
  LineChart,
  Plus,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  User,
  Wallet,
  CheckCircle2,
  Clock,
  Eye,
  PiggyBank,
  Banknote,
  ArrowLeftRight,
  Share2,
} from 'lucide-react';
import Link from 'next/link';
import { isTMA, getInitData, haptic } from '@/lib/telegram';
import { apiConfigured, getMe, getMarket, Me, ApiPosition, SavingsPosition, MarketSnapshot, MarketRow } from '@/lib/api';
import { SharePnLModal, type PnLData } from '@/components/SharePnLModal';
import { WatchAddressModal } from '@/components/WatchAddressModal';
import { OnboardingModal } from '@/components/OnboardingModal';
import { sound } from '@/lib/sound';
import {
  AppShell,
  AddressChip,
  ActionTile,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  LoadingRegion,
  SectionTitle,
  Skeleton,
  Stat,
} from '@/components/ui';

import { useT, useLocale } from '@/lib/i18n';
import TokenIcon from '@/components/TokenIcon';
import { formatExactDecimal } from '@/lib/amount';

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'FxAeonBot';

function fmt(value?: string): string {
  if (value === undefined) return '—';
  if (/^-?0*\.0*[1-9]\d*$/.test(value)) {
    const fraction = value.split('.')[1] ?? '';
    const firstNonZero = fraction.search(/[1-9]/);
    if (firstNonZero >= 4) return '<0.0001';
  }
  return formatExactDecimal(value, 4);
}

function usd2(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function signedUsd(n: number): string {
  return `${n < 0 ? '-' : '+'}$${usd2(Math.abs(n))}`;
}

function fmtMarketPrice(n: number): string {
  if (n >= 1000) return `$${Math.round(n).toLocaleString('en-US')}`;
  if (n >= 10) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(4)}`;
}

/* ----------------------------------------------------------------- pieces */

/** Decorative violet flow line for the hero — ornament, not data. */
function HeroWave() {
  return (
    <svg
      className="pointer-events-none absolute right-0 top-0 h-full w-2/3 opacity-70"
      viewBox="0 0 240 140"
      fill="none"
      aria-hidden="true"
      preserveAspectRatio="xMaxYMid slice"
    >
      <defs>
        <linearGradient id="wave" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--mint)" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--cyan)" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <path d="M-20 110 C 60 110, 90 50, 150 42 S 230 20, 270 -10" stroke="url(#wave)" strokeWidth="2" />
      <path d="M0 128 C 80 124, 110 70, 168 60 S 240 38, 280 8" stroke="url(#wave)" strokeWidth="1.4" opacity="0.6" />
      <path d="M30 138 C 100 134, 130 92, 188 82 S 250 60, 300 32" stroke="url(#wave)" strokeWidth="1" opacity="0.4" />
    </svg>
  );
}

function ProfileAvatar() {
  return (
    <Link
      href="/settings"
      onClick={() => haptic('light')}
      aria-label="Settings"
      className="glass-press flex h-11 w-11 items-center justify-center rounded-full ring-2 ring-[var(--mint)]/60"
      style={{ background: 'linear-gradient(135deg, var(--mint), var(--cyan))' }}
    >
      <User className="h-5 w-5 text-white" strokeWidth={2} />
    </Link>
  );
}

/** Circular token mark with a real logo and a leverage badge. */
function TokenGlyph({ symbol, leverage }: { symbol: string; leverage: number }) {
  return (
    <span className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center">
      <TokenIcon symbol={symbol} size={44} />
      <span className="absolute -bottom-1 -left-1 rounded-full border-2 border-[var(--card)] bg-[var(--bg)] px-1.5 py-[1px] text-[9px] font-bold text-mint">
        {leverage % 1 === 0 ? leverage : leverage.toFixed(1)}x
      </span>
    </span>
  );
}

function PositionCard({ p, onShare }: { p: ApiPosition; onShare?: (p: ApiPosition) => void }) {
  const t = useT();
  const router = useRouter();
  const token = p.collateralToken || p.market;
  const healthTone =
    p.healthPercent >= 0.5 ? 'bg-success' : p.healthPercent >= 0.25 ? 'bg-warn' : 'bg-danger';
  const sizeText =
    p.collateral !== undefined ? `${fmt(p.collateral)} ${token}` : undefined;

  return (
    <div className="glass glass-press flex w-full items-center gap-3 p-3.5 text-left">
      <div
        role="button"
        tabIndex={0}
        aria-label={`${p.market} ${p.side} position, ${p.leverage}x leverage`}
        onClick={() => {
          haptic('light');
          router.push('/positions');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            haptic('light');
            router.push('/positions');
          }
        }}
        className="flex min-w-0 flex-1 items-center gap-3 cursor-pointer outline-none"
      >
        <TokenGlyph symbol={token} leverage={p.leverage} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-display text-[15px] font-semibold">{p.market}</span>
            <span className="text-[13px] font-semibold text-gradient">
              {p.leverage % 1 === 0 ? p.leverage : p.leverage.toFixed(1)}x
            </span>
          </div>
          <p className="mt-0.5 truncate text-[12px] text-mut">
            <span className="text-success">●</span> {t(`portfolio.${p.side}`)}
            {sizeText ? ` · ${t('portfolio.size')} ${sizeText}` : ''}
          </p>
          {/* Real health indicator */}
          <div className="mt-2 flex items-center gap-2">
            <span
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]"
              role="progressbar"
              aria-label="Position health"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.max(0, Math.min(100, Math.round(p.healthPercent * 100)))}
            >
              <span
                className={`block h-full rounded-full ${healthTone}`}
                style={{ width: `${Math.min(100, Math.max(6, Math.round(p.healthPercent * 100)))}%` }}
              />
            </span>
            <span className="text-[10px] text-mut">{Math.round(p.healthPercent * 100)}%</span>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {typeof p.pnlUsd === 'number' ? (
          <div className="flex flex-col items-end leading-tight">
            <span className={`text-[14px] font-semibold ${p.pnlUsd >= 0 ? 'text-success' : 'text-danger'}`}>
              {typeof p.pnlPct === 'number'
                ? `${p.pnlPct >= 0 ? '+' : '−'}${Math.abs(p.pnlPct).toFixed(1)}% PnL`
                : signedUsd(p.pnlUsd)}
            </span>
            {(typeof p.pnlPct === 'number' || typeof p.entryPrice === 'number') && (
              <span className="text-[11px] font-medium text-mut">
                {typeof p.pnlPct === 'number' ? signedUsd(p.pnlUsd) : ''}
                {typeof p.pnlPct === 'number' && typeof p.entryPrice === 'number' ? ' · ' : ''}
                {typeof p.entryPrice === 'number' ? `Entry ${fmtMarketPrice(p.entryPrice)}` : ''}
              </span>
            )}
          </div>
        ) : (
          <span className="text-[13px] font-medium text-mut">—</span>
        )}
        {onShare && (
          <button
            type="button"
            aria-label={`Share ${p.market} ${p.side} position badge`}
            onClick={(e) => {
              e.stopPropagation();
              haptic('medium');
              onShare(p);
            }}
            className="flex min-h-8 min-w-8 items-center justify-center rounded-lg bg-[rgba(255,255,255,0.06)] p-1.5 text-mut transition-colors hover:bg-[var(--mint-dim)] hover:text-mint"
          >
            <Share2 className="h-3.5 w-3.5" />
          </button>
        )}
        <ChevronRight className="h-4 w-4 text-mut" />
      </div>
    </div>
  );
}

/** The user's real fxSAVE (stability pool) holding — value + redeem status. */
function SavingsCard({ s }: { s: SavingsPosition }) {
  const t = useT();
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label={`${t('portfolio.savingsTitle')}, ${fmt(s.shares)} shares`}
      onClick={() => {
        haptic('light');
        router.push('/earn');
      }}
      className="glass glass-press flex w-full items-center gap-3 p-3.5 text-left"
    >
      <TokenIcon symbol="fxSAVE" size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-display text-[15px] font-semibold">{t('portfolio.savingsTitle')}</span>
          <span className="rounded-full bg-[var(--mint-dim)] px-1.5 py-[1px] text-[9px] font-bold text-mint">
            fxSAVE
          </span>
        </div>
        <p className="mt-0.5 truncate text-[12px] text-mut">
          <span className="text-success">●</span> {t('portfolio.savingsShares', { shares: fmt(s.shares) })}
        </p>
        {s.pendingRedeem && (
          <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-warn">
            {s.redeemReady ? (
              <>
                <CheckCircle2 className="h-3 w-3 text-success" />
                <span className="text-success">{t('portfolio.savingsRedeemReady')}</span>
              </>
            ) : (
              <>
                <Clock className="h-3 w-3" />
                {t('portfolio.savingsRedeemPending')}
              </>
            )}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {typeof s.valueUsd === 'number' ? (
          <span className="text-[14px] font-semibold">${usd2(s.valueUsd)}</span>
        ) : (
          <span className="text-[12px] font-medium text-mut">{t('portfolio.savingsValuePending')}</span>
        )}
        <ChevronRight className="h-4 w-4 text-mut" />
      </div>
    </button>
  );
}

/** Canonical display order for the Markets table. fxUSD must sit right below FXN. */
const MARKET_ORDER: Record<string, number> = {
  BTC: 0,
  ETH: 1,
  FXN: 2,
  fxUSD: 3,
  FRAX: 4,
  CRV: 5,
  CVX: 6,
  AAVE: 7,
  MORPHO: 8,
  SDT: 9,
  LDO: 10,
  PENDLE: 11,
  FLUID: 12,
  ETHFI: 13,
  wstETH: 14,
  WBTC: 15,
};

function marketSort(a: MarketRow, b: MarketRow): number {
  const oa = MARKET_ORDER[a.symbol] ?? 100;
  const ob = MARKET_ORDER[b.symbol] ?? 100;
  if (oa !== ob) return oa - ob;
  return a.symbol.localeCompare(b.symbol);
}

function MarketsCard({ market }: { market: MarketSnapshot }) {
  const t = useT();
  const rows = market.rows.filter((r) => r.data !== null).sort(marketSort);
  if (rows.length === 0) return null;
  return (
    <Card>
      <div className="flex flex-col divide-y divide-[rgba(255,255,255,0.06)]">
        {rows.map((r) => {
          const d = r.data!;
          const ch = d.change24hPct;
          const tone = ch === null ? 'text-mut' : ch >= 0 ? 'text-success' : 'text-danger';
          return (
            <div key={r.symbol} className="flex items-center justify-between py-2 first:pt-0 last:pb-0 text-[12.5px]">
              <span className="flex w-20 items-center gap-2 font-medium">
                <TokenIcon symbol={r.symbol} size={20} />
                {r.symbol}
              </span>
              <span className="font-mono">{fmtMarketPrice(d.priceUsd)}</span>
              <span className={`w-16 text-right font-medium ${tone}`}>
                {ch === null ? '—' : `${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%`}
              </span>
            </div>
          );
        })}
      </div>
      {market.stale && <p className="mt-2 text-[10.5px] text-mut">{t('portfolio.pricesStale')}</p>}
    </Card>
  );
}

/* ------------------------------------------------------------------- page */

export default function PortfolioPage() {
  const t = useT();
  const { setLocale } = useLocale();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [marketError, setMarketError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'positions' | 'fxusd'>('positions');
  const [shareData, setShareData] = useState<PnLData | null>(null);
  const [watchModalOpen, setWatchModalOpen] = useState(false);

  const loadMarket = useCallback(async () => {
    setMarketError('');
    try {
      setMarket(await getMarket());
    } catch (cause) {
      setMarket(null);
      setMarketError(cause instanceof Error ? cause.message : 'Live market data is unavailable.');
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getMe();
      if (!data.onboarded) {
        router.replace('/login');
        return;
      }
      setMe(data);
      setLocale(data.language);
      await loadMarket();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [loadMarket, router, setLocale]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (isTMA() && getInitData() && apiConfigured()) void load();
    else setLoading(false);
  }, [mounted, load]);

  if (!mounted) return <AppShell title={t('portfolio.title')}>{null}</AppShell>;

  // -- Honest degraded states (no fake zeros) ------------------------------
  if (!isTMA()) {
    return (
      <AppShell title={t('portfolio.title')} tabs={false}>
        <EmptyState
          icon={Send}
          title={t('portfolio.openInTgTitle')}
          body={t('portfolio.openInTgBody')}
          action={
            <ButtonLink href={`https://t.me/${BOT_USERNAME}`} external>
              {t('common.openBot', { bot: BOT_USERNAME })}
            </ButtonLink>
          }
        />
      </AppShell>
    );
  }

  if (!getInitData() || !apiConfigured()) {
    return (
      <AppShell title={t('portfolio.title')}>
        <EmptyState
          icon={PlugZap}
          title={t('portfolio.degradedTitle')}
          body={!getInitData() ? t('portfolio.degradedNoInit') : t('portfolio.degradedNoBackend')}
        />
      </AppShell>
    );
  }

  if (loading) {
    return (
      <AppShell title={t('portfolio.title')}>
        <LoadingRegion label="Loading your portfolio" className="flex flex-col gap-3">
          <Skeleton className="h-36" />
          <Skeleton className="h-10" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </LoadingRegion>
      </AppShell>
    );
  }

  if (error || !me) {
    return (
      <AppShell title={t('portfolio.title')}>
        <EmptyState
          icon={RefreshCw}
          title={t('portfolio.loadFailTitle')}
          body={error || t('common.unknownError')}
          action={<Button onClick={() => void load()}>{t('common.retry')}</Button>}
        />
      </AppShell>
    );
  }

  const funding = me.funding;
  const positions = me.positions ?? [];
  const summary = me.summary;
  // Only the backend's all-token, chain-derived aggregate may declare a
  // wallet empty. Deriving this from the three summary tiles would hide USDC,
  // USDT, fxUSD, WETH, stETH, and base-pool balances.
  const confirmedEmptyWallet =
    funding?.known &&
    funding.funded === false;

  const total = summary?.totalValueUsd;
  const netPnl = summary?.netPnlUsd;
  const netPnlPct = summary?.netPnlPct;

  return (
    <AppShell>
      <div className="stagger flex flex-col">
        {/* Header: title + avatar */}
        <header className="anim-fade-up mb-5 flex items-center justify-between">
          <div>
            <p className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.17em] text-mut">
              <span className="status-dot" aria-hidden="true" /> Ethereum mainnet
            </p>
            <h1 className="text-display text-[28px] font-semibold leading-tight tracking-[-0.04em]">{t('portfolio.title')}</h1>
          </div>
          <ProfileAvatar />
        </header>

        {/* Total Value hero */}
        <Card
          glow
          className="relative overflow-hidden border border-[var(--mint)]/45 p-5"
        >
          <HeroWave />
          <div className="relative">
            <p className="text-[12px] text-mut">{t('portfolio.totalValue')}</p>
            {typeof total === 'number' ? (
              <p className="text-display mt-1 break-words text-[clamp(1.8rem,9vw,2.125rem)] font-bold leading-none">${usd2(total)}</p>
            ) : (
              <>
                <p className="text-display mt-1 text-[34px] font-bold leading-none text-mut">—</p>
                <p className="mt-1 text-[11px] text-mut">{t('portfolio.valueUnavailable')}</p>
              </>
            )}
            {typeof netPnl === 'number' && (
              <span
                className={`mt-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium ${
                  netPnl >= 0 ? 'bg-[var(--success-dim)] text-success' : 'bg-[rgba(255,90,95,0.12)] text-danger'
                }`}
              >
                {netPnl >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                {signedUsd(netPnl)}
                {typeof netPnlPct === 'number' ? ` (${netPnlPct >= 0 ? '+' : ''}${netPnlPct.toFixed(2)}%)` : ''}
                <span className="opacity-70">· {t('portfolio.pnlUnrealized')}</span>
              </span>
            )}
          </div>
        </Card>

        {/* Tabs */}
        <div className="mt-4 grid grid-cols-2 gap-1 rounded-2xl border border-[var(--line)] bg-[rgba(255,255,255,0.035)] p-1" role="tablist" aria-label="Portfolio views">
          {(['positions', 'fxusd'] as const).map((key) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls="portfolio-tabpanel"
                id={`portfolio-tab-${key}`}
                tabIndex={active ? 0 : -1}
                onClick={() => {
                  haptic('selection');
                  setTab(key);
                }}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const next = event.key === 'ArrowLeft' || event.key === 'Home' ? 'positions' : 'fxusd';
                  setTab(next);
                  event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#portfolio-tab-${next}`)?.focus();
                  haptic('selection');
                }}
                className={`min-h-11 rounded-xl py-2 text-[13px] font-semibold transition-colors ${
                  active ? 'bg-[var(--mint-dim)] text-mint shadow-[inset_0_0_0_1px_rgba(139,109,255,0.1)]' : 'text-mut'
                }`}
              >
                {key === 'positions' ? t('portfolio.tabPositions') : t('portfolio.tabFxusd')}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div id="portfolio-tabpanel" role="tabpanel" aria-labelledby={`portfolio-tab-${tab}`} className="mt-3">
          {tab === 'positions' ? (
            <>
              {me.positionsKnown === false && (
                <Card className="mb-2.5 border border-[rgba(255,193,77,0.3)]">
                  <p className="text-[12.5px] text-mut">{t('portfolio.positionsIncomplete')}</p>
                </Card>
              )}
              {positions.length > 0 ? (
                <div className="flex flex-col gap-2.5">
                  {positions.map((p) => (
                    <PositionCard
                      key={`${p.market}-${p.side}-${p.tokenId}`}
                      p={p}
                      onShare={(pos) =>
                        setShareData({
                          market: pos.market,
                          side: pos.side,
                          leverage: pos.leverage,
                          pnlUsd: pos.pnlUsd,
                          pnlPct: pos.pnlPct,
                          entryPrice: pos.entryPrice,
                          referralCode: me.referralCode ?? undefined,
                        })
                      }
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={LineChart}
                  title={t('portfolio.noPositionsTitle')}
                  body={t('portfolio.noPositionsBody')}
                />
              )}
            </>
          ) : (
            <>
              {me.savingsKnown === false && (
                <Card className="mb-2.5 border border-[rgba(255,193,77,0.3)]">
                  <p className="text-[12.5px] text-mut">{t('portfolio.savingsIncomplete')}</p>
                </Card>
              )}
              {me.savings ? (
                <SavingsCard s={me.savings} />
              ) : (
                <EmptyState
                  icon={Wallet}
                  title={t('portfolio.fxusdEmptyTitle')}
                  body={t('portfolio.fxusdEmptyBody')}
                />
              )}
            </>
          )}
        </div>

        {/* New Position */}
        <div className="mt-5 flex justify-center">
          <div className="w-full max-w-[300px]">
            <Button className="rounded-full" onClick={() => router.push('/trade')}>
              <Plus className="h-4 w-4" /> {t('portfolio.newPosition')}
            </Button>
          </div>
        </div>

        {/* ----- Secondary, still-real account details (below the hero) ----- */}
        <SectionTitle
          right={
            <button
              type="button"
              onClick={() => void load()}
              className="-m-2 flex min-h-11 min-w-11 items-center justify-center rounded-xl text-mut transition-colors hover:text-mint"
              aria-label="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          }
        >
          {t('portfolio.walletLabel')}
        </SectionTitle>
        <Card className="relative overflow-hidden">
          <div className="flex items-center justify-between">
            {me.walletAddress ? <AddressChip address={me.walletAddress} /> : <span className="text-[12px] text-warn">Wallet address unavailable</span>}
            <span className="flex items-center gap-1 rounded-full bg-[var(--mint-dim)] px-2.5 py-1 text-[10.5px] font-medium text-mint">
              <ShieldCheck className="h-3 w-3" /> {t('portfolio.selfCustodyBadge')}
            </span>
          </div>
          {me.referralCode && (
            <p className="mt-3 text-[11.5px] text-mut">
              {t('portfolio.referralCode')} <span className="font-mono text-mint">{me.referralCode}</span>
            </p>
          )}
        </Card>

        <SectionTitle>{t('portfolio.balances')}</SectionTitle>
        {funding?.known ? (
          <div className="grid grid-cols-3 gap-2.5">
            <Stat label="ETH" value={fmt(funding.eth)} accent={Boolean(funding.eth && /[1-9]/.test(funding.eth))} />
            <Stat label="wstETH" value={fmt(funding.wstEth)} accent={Boolean(funding.wstEth && /[1-9]/.test(funding.wstEth))} />
            <Stat label="WBTC" value={fmt(funding.wbtc)} accent={Boolean(funding.wbtc && /[1-9]/.test(funding.wbtc))} />
          </div>
        ) : (
          <Card>
            <p className="text-[12.5px] text-mut">{t('portfolio.balancesUnavailable')}</p>
          </Card>
        )}
        {confirmedEmptyWallet && (
          <Card className="mt-2.5 border border-[rgba(124,92,255,0.25)]">
            <p className="text-[13px] leading-relaxed">
              <span className="font-medium text-mint">{t('portfolio.fundTitle')}</span>{' '}
              <span className="text-mut">{t('portfolio.fundBody')}</span>
            </p>
            <div className="mt-3">
              <ActionTile icon={QrCode} label={t('portfolio.showDeposit')} href="/qr" />
            </div>
          </Card>
        )}

        {market && (
          <>
            <SectionTitle>{t('portfolio.markets')}</SectionTitle>
            <MarketsCard market={market} />
          </>
        )}
        {!market && marketError && (
          <>
            <SectionTitle>{t('portfolio.markets')}</SectionTitle>
            <Card className="border-[rgba(255,194,102,.24)]">
              <p role="alert" className="text-[12px] leading-relaxed text-warn">Market data unavailable: {marketError}</p>
              <Button variant="ghost" className="mt-3" onClick={() => void loadMarket()}>
                <RefreshCw aria-hidden="true" className="h-4 w-4" /> Retry markets
              </Button>
            </Card>
          </>
        )}

        <SectionTitle>{t('portfolio.quickActions')}</SectionTitle>
        <div className="grid grid-cols-2 gap-2.5">
          <ActionTile icon={CandlestickChart} label={t('nav.trade')} hint={t('portfolio.qaTradeHint')} href="/trade" />
          <ActionTile icon={PiggyBank} label={t('nav.earn')} hint="Deposit or redeem fxSAVE" href="/earn" />
          <ActionTile icon={Banknote} label="Borrow" hint="Mint or repay fxUSD" href="/borrow" />
          <ActionTile icon={ArrowLeftRight} label={t('nav.move')} hint="Bridge Ethereum ↔ Base" href="/move" />
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => {
              sound.tap();
              haptic('selection');
              setWatchModalOpen(true);
            }}
            className="glass glass-press flex w-full items-center gap-3 p-3.5 text-left"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--mint-dim)] text-mint">
              <Eye className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-display block text-[13.5px] font-semibold text-white">Whale Mirror</span>
              <span className="block truncate text-[11px] text-mut">Inspect any 0x / ENS</span>
            </div>
          </button>
          <ActionTile
            icon={ShieldCheck}
            label={t('portfolio.qaSecurity')}
            hint={t('portfolio.qaSecurityHint')}
            href="/policy"
          />
        </div>

        {shareData && (
          <SharePnLModal
            isOpen={Boolean(shareData)}
            onClose={() => setShareData(null)}
            data={shareData}
          />
        )}

        <WatchAddressModal
          isOpen={watchModalOpen}
          onClose={() => setWatchModalOpen(false)}
        />

        <OnboardingModal />
      </div>
    </AppShell>
  );
}
