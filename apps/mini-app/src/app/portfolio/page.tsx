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
} from 'lucide-react';
import Link from 'next/link';
import { isTMA, getInitData, haptic } from '@/lib/telegram';
import { apiConfigured, getMe, getMarket, Me, ApiPosition, MarketSnapshot } from '@/lib/api';
import {
  AppShell,
  AddressChip,
  ActionTile,
  Button,
  Card,
  EmptyState,
  SectionTitle,
  Skeleton,
  Stat,
} from '@/components/ui';

import { useT, useLocale } from '@/lib/i18n';

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'FxAeonBot';

function fmt(value?: string): string {
  if (value === undefined) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n === 0) return '0';
  if (n < 0.0001) return '<0.0001';
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
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
      className="glass-press flex h-10 w-10 items-center justify-center rounded-full ring-2 ring-[var(--mint)]/60"
      style={{ background: 'linear-gradient(135deg, var(--mint), var(--cyan))' }}
    >
      <User className="h-5 w-5 text-white" strokeWidth={2} />
    </Link>
  );
}

/** Circular token mark with a leverage badge, like the mockup's coin icons. */
function TokenGlyph({ symbol, leverage }: { symbol: string; leverage: number }) {
  const label = symbol.replace(/^[wx]/i, '').slice(0, 4).toUpperCase() || symbol.toUpperCase();
  return (
    <span className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center">
      <span
        className="flex h-11 w-11 items-center justify-center rounded-full text-[11px] font-bold text-white"
        style={{ background: 'linear-gradient(135deg, var(--mint), var(--cyan))' }}
      >
        {label}
      </span>
      <span className="absolute -bottom-1 -left-1 rounded-full border-2 border-[var(--card)] bg-[var(--bg)] px-1.5 py-[1px] text-[9px] font-bold text-mint">
        {leverage % 1 === 0 ? leverage : leverage.toFixed(1)}x
      </span>
    </span>
  );
}

function PositionCard({ p }: { p: ApiPosition }) {
  const t = useT();
  const router = useRouter();
  const token = p.collateralToken || p.market;
  const healthTone =
    p.healthPercent >= 0.5 ? 'bg-success' : p.healthPercent >= 0.25 ? 'bg-warn' : 'bg-danger';
  const sizeText =
    p.collateral !== undefined ? `${fmt(p.collateral)} ${token}` : undefined;

  return (
    <button
      type="button"
      onClick={() => {
        haptic('light');
        router.push('/trade');
      }}
      className="glass glass-press flex w-full items-center gap-3 p-3.5 text-left"
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
        {/* Real health indicator (replaces the mockup's price sparkline, which
            needs a price-history feed the protocol doesn't expose yet). */}
        <div className="mt-2 flex items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
            <span
              className={`block h-full rounded-full ${healthTone}`}
              style={{ width: `${Math.max(6, Math.round(p.healthPercent * 100))}%` }}
            />
          </span>
          <span className="text-[10px] text-mut">{Math.round(p.healthPercent * 100)}%</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {typeof p.pnlUsd === 'number' ? (
          <span className={`text-[14px] font-semibold ${p.pnlUsd >= 0 ? 'text-success' : 'text-danger'}`}>
            {signedUsd(p.pnlUsd)}
          </span>
        ) : (
          <span className="text-[13px] font-medium text-mut">—</span>
        )}
        <ChevronRight className="h-4 w-4 text-mut" />
      </div>
    </button>
  );
}

function MarketsCard({ market }: { market: MarketSnapshot }) {
  const t = useT();
  const rows = market.rows.filter((r) => r.data !== null);
  if (rows.length === 0) return null;
  return (
    <Card>
      <div className="flex flex-col divide-y divide-[rgba(255,255,255,0.06)]">
        {rows.map((r) => {
          const d = r.data!;
          const ch = d.change24hPct;
          const tone = ch === null ? 'text-mut' : ch >= 0 ? 'text-success' : 'text-danger';
          return (
            <div key={r.symbol} className="flex items-center justify-between py-1.5 first:pt-0 last:pb-0 text-[12.5px]">
              <span className="w-16 font-medium">{r.symbol}</span>
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'positions' | 'fxusd'>('positions');

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
      try {
        setMarket(await getMarket());
      } catch {
        setMarket(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [router]);

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
            <a href={`https://t.me/${BOT_USERNAME}`}>
              <Button>{t('common.openBot', { bot: BOT_USERNAME })}</Button>
            </a>
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
        <div className="flex flex-col gap-3">
          <Skeleton className="h-36" />
          <Skeleton className="h-10" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
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
  const noFunds =
    funding?.known &&
    Number(funding.eth ?? 0) === 0 &&
    Number(funding.wstEth ?? 0) === 0 &&
    Number(funding.wbtc ?? 0) === 0;

  const total = summary?.totalValueUsd;
  const netPnl = summary?.netPnlUsd;
  const netPnlPct = summary?.netPnlPct;

  return (
    <AppShell>
      <div className="stagger flex flex-col">
        {/* Header: title + avatar */}
        <header className="anim-fade-up mb-4 flex items-center justify-between">
          <h1 className="text-display text-[26px] font-semibold leading-tight">{t('portfolio.title')}</h1>
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
              <p className="text-display mt-1 text-[34px] font-bold leading-none">${usd2(total)}</p>
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
        <div className="mt-4 grid grid-cols-2 gap-1 rounded-2xl bg-[rgba(255,255,255,0.04)] p-1">
          {(['positions', 'fxusd'] as const).map((key) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  haptic('selection');
                  setTab(key);
                }}
                className={`rounded-xl py-2 text-[13px] font-semibold transition-colors ${
                  active ? 'bg-[var(--mint-dim)] text-mint' : 'text-mut'
                }`}
              >
                {key === 'positions' ? t('portfolio.tabPositions') : t('portfolio.tabFxusd')}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="mt-3">
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
                    <PositionCard key={p.tokenId} p={p} />
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
            <EmptyState
              icon={Wallet}
              title={t('portfolio.fxusdEmptyTitle')}
              body={t('portfolio.fxusdEmptyBody')}
            />
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
              className="text-mut transition-colors hover:text-mint"
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
            <AddressChip address={me.walletAddress!} />
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
            <Stat label="ETH" value={fmt(funding.eth)} accent={Number(funding.eth) > 0} />
            <Stat label="wstETH" value={fmt(funding.wstEth)} accent={Number(funding.wstEth) > 0} />
            <Stat label="WBTC" value={fmt(funding.wbtc)} accent={Number(funding.wbtc) > 0} />
          </div>
        ) : (
          <Card>
            <p className="text-[12.5px] text-mut">{t('portfolio.balancesUnavailable')}</p>
          </Card>
        )}
        {noFunds && (
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

        <SectionTitle>{t('portfolio.quickActions')}</SectionTitle>
        <div className="grid grid-cols-2 gap-2.5">
          <ActionTile icon={CandlestickChart} label={t('nav.trade')} hint={t('portfolio.qaTradeHint')} href="/trade" />
          <ActionTile icon={QrCode} label={t('nav.deposit')} hint={t('portfolio.qaDepositHint')} href="/qr" />
        </div>
        <div className="mt-2.5">
          <ActionTile
            icon={ShieldCheck}
            label={t('portfolio.qaSecurity')}
            hint={t('portfolio.qaSecurityHint')}
            href="/policy"
          />
        </div>
      </div>
    </AppShell>
  );
}
