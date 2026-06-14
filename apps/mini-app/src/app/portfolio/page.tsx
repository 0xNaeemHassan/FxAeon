'use client';

/**
 * Home — the user's real account state, served by the authenticated bot API.
 * No placeholder numbers: every value on this screen is read from the chain
 * or the bot's database, and every state has a next step.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Wallet,
  QrCode,
  CandlestickChart,
  ShieldCheck,
  RefreshCw,
  Send,
  PlugZap,
  LineChart,
} from 'lucide-react';
import { isTMA, getInitData } from '@/lib/telegram';
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

function fmtMarketPrice(n: number): string {
  if (n >= 1000) return `$${Math.round(n).toLocaleString('en-US')}`;
  if (n >= 10) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(4)}`;
}

/**
 * Live markets strip — real CoinGecko data via the authenticated bot API
 * (the same cached snapshot the bot's /price uses). Renders nothing while
 * unavailable: no fake numbers, and the portfolio stays the hero.
 */
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
      {market.stale && (
        <p className="mt-2 text-[10.5px] text-mut">{t('portfolio.pricesStale')}</p>
      )}
    </Card>
  );
}

function PositionCard({ p }: { p: ApiPosition }) {
  const t = useT();
  const long = p.side === 'long';
  const healthTone =
    p.healthPercent >= 0.5 ? 'text-success' : p.healthPercent >= 0.25 ? 'text-warn' : 'text-danger';
  return (
    <Card className="glass-press">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold uppercase ${
              long ? 'bg-[var(--success-dim)] text-success' : 'bg-[rgba(255,90,95,0.12)] text-danger'
            }`}
          >
            {t(`portfolio.${p.side}`)}
          </span>
          <span className="text-display text-[16px] font-semibold">{p.market}</span>
        </div>
        <span className="text-display text-[15px] font-semibold text-gradient">
          {p.leverage}x
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
        <div>
          <p className="text-mut">{t('portfolio.colCollateral')}</p>
          <p className="mt-0.5 font-medium">{fmt(p.collateral)}</p>
        </div>
        <div>
          <p className="text-mut">{t('portfolio.colPnl')}</p>
          {typeof p.pnlUsd === 'number' ? (
            <p className={`mt-0.5 font-medium ${p.pnlUsd >= 0 ? 'text-success' : 'text-danger'}`}>
              {p.pnlUsd >= 0 ? '+' : '-'}${Math.abs(p.pnlUsd).toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </p>
          ) : (
            <p className="mt-0.5 font-medium text-mut">—</p>
          )}
        </div>
        <div>
          <p className="text-mut">{t('portfolio.colHealth')}</p>
          <p className={`mt-0.5 font-medium ${healthTone}`}>
            {Math.round(p.healthPercent * 100)}%
          </p>
        </div>
      </div>
    </Card>
  );
}

export default function PortfolioPage() {
  const t = useT();
  const { setLocale } = useLocale();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
      // Markets are decoration, not account state — never block or fail the
      // page on them.
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
          <div className="grid grid-cols-3 gap-2.5">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
          <Skeleton className="h-24" />
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
  const noFunds =
    funding?.known &&
    Number(funding.eth ?? 0) === 0 &&
    Number(funding.wstEth ?? 0) === 0 &&
    Number(funding.wbtc ?? 0) === 0;

  return (
    <AppShell>
      <div className="stagger flex flex-col">
        {/* Wallet hero */}
        <Card glow className="relative overflow-hidden p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[12px] text-mut">
              <Wallet className="h-4 w-4 text-mint" />
              {t('portfolio.walletLabel')}
            </div>
            <span className="flex items-center gap-1 rounded-full bg-[var(--mint-dim)] px-2.5 py-1 text-[10.5px] font-medium text-mint">
              <ShieldCheck className="h-3 w-3" /> {t('portfolio.selfCustodyBadge')}
            </span>
          </div>
          <div className="mt-4">
            <AddressChip address={me.walletAddress!} />
          </div>
          {me.referralCode && (
            <p className="mt-3 text-[11.5px] text-mut">
              {t('portfolio.referralCode')} <span className="font-mono text-mint">{me.referralCode}</span>
            </p>
          )}
        </Card>

        {/* Balances */}
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
          {t('portfolio.balances')}
        </SectionTitle>
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
          <Card className="mt-2.5 border-[rgba(124, 92, 255,0.25)]">
            <p className="text-[13px] leading-relaxed">
              <span className="font-medium text-mint">{t('portfolio.fundTitle')}</span>{' '}
              <span className="text-mut">{t('portfolio.fundBody')}</span>
            </p>
            <div className="mt-3">
              <ActionTile icon={QrCode} label={t('portfolio.showDeposit')} href="/qr" />
            </div>
          </Card>
        )}

        {/* Positions */}
        <SectionTitle>{t('portfolio.positions')}</SectionTitle>
        {me.positionsKnown === false && (
          <Card className="mb-2.5 border-[rgba(255,193,77,0.3)]">
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
            action={<Button onClick={() => router.push('/trade')}>{t('portfolio.setupTrade')}</Button>}
          />
        )}

        {/* Markets */}
        {market && (
          <>
            <SectionTitle>{t('portfolio.markets')}</SectionTitle>
            <MarketsCard market={market} />
          </>
        )}

        {/* Quick actions */}
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
