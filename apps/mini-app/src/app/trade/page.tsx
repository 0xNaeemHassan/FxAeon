'use client';

/**
 * Trade builder + in-app execution (mockup screens 2/3/5).
 *
 * SAFETY — the Mini App does NOT sign or broadcast anything itself, and it
 * never trusts client-built calldata (the old, audited P0-2 danger). Confirm
 * calls the bot's server-side engine via /trade/quote and /trade/execute,
 * which rebuild the route, run a fail-closed simulation, enforce the
 * session-signer grant and broadcast through Privy — the exact same path the
 * bot chat uses. See apps/bot/src/core/miniappTrade.ts and docs/audit/AUDIT.md.
 *
 * Honesty: every number shown comes from a live on-chain read (SDK execution
 * route + a real simulateCalls gas estimate + EIP-1559 feeHistory). When the
 * API isn't reachable (e.g. a keyboard launch with no initData) we fall back
 * to the unsigned bot deep-link handoff instead of faking a quote.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  TrendingUp,
  TrendingDown,
  ArrowRight,
  ArrowDown,
  ShieldCheck,
  ChevronLeft,
  ChevronDown,
  ExternalLink,
  Check,
  Loader2,
  AlertTriangle,
  Fuel,
} from 'lucide-react';
import { getWebApp, haptic, isTMA, showMainButton } from '@/lib/telegram';
import { RISK_PARAMS } from '@fxbot/shared';
import { AppShell, Button, Card, FullScreenSpinner } from '@/components/ui';
import { useT } from '@/lib/i18n';
import {
  apiAvailable,
  tradeQuote,
  tradeExecute,
  ApiError,
  type TradeQuote,
  type TradeExecuteResult,
  type FeeTierKey,
} from '@/lib/api';

const MARKET_INDEX: Record<string, number> = { wstETH: 0, WBTC: 1 };
const MARKETS = Object.keys(MARKET_INDEX);
const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'FxAeonBot';
const QUOTE_TTL_SEC = 15; // live quote/gas go stale — auto-refresh window

type Step = 'build' | 'review' | 'executing' | 'done';

function buildBotDeepLink(market: string, side: string, leverage: number, amount: number): string | null {
  const mIdx = MARKET_INDEX[market];
  if (mIdx === undefined || !Number.isFinite(leverage) || !(amount > 0)) return null;
  const payload = `tq_${mIdx}_${side === 'short' ? 's' : 'l'}_${Math.round(leverage * 10)}_${Math.round(amount * 1e6)}`;
  return `https://t.me/${BOT_USERNAME}?start=${payload}`;
}

/** One opaque idempotency nonce per Confirm session — dedupes double-taps. */
function makeNonce(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `n-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function fmt(n: number, max = 4): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: max });
}

function shortHash(h: string): string {
  return h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}

function TradeContent() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>('build');
  const [market, setMarket] = useState(
    MARKET_INDEX[searchParams.get('market') ?? ''] !== undefined
      ? (searchParams.get('market') as string)
      : 'wstETH'
  );
  const [side, setSide] = useState<'long' | 'short'>(searchParams.get('side') === 'short' ? 'short' : 'long');
  const [leverage, setLeverage] = useState(() => {
    const v = parseFloat(searchParams.get('lev') || '3');
    return Number.isFinite(v) ? v : 3;
  });
  const [amount, setAmount] = useState(searchParams.get('amt') || '');

  const isLong = side === 'long';
  const maxLev = isLong ? RISK_PARAMS.MAX_LEVERAGE_LONG : RISK_PARAMS.MAX_LEVERAGE_SHORT;
  const minLev = RISK_PARAMS.MIN_LEVERAGE;

  useEffect(() => {
    setLeverage((l) => Math.min(Math.max(l, minLev), maxLev));
  }, [maxLev, minLev]);

  const amt = parseFloat(amount);
  const valid = Number.isFinite(amt) && amt > 0 && leverage >= minLev && leverage <= maxLev;
  const deepLink = useMemo(
    () => (valid ? buildBotDeepLink(market, side, leverage, amt) : null),
    [valid, market, side, leverage, amt]
  );

  // ── Review / execution state ──────────────────────────────────────────
  const params = useMemo(
    () => ({ market, side, leverage, amount: amt }),
    [market, side, leverage, amt]
  );
  const [quote, setQuote] = useState<TradeQuote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [gasOpen, setGasOpen] = useState(false);
  const [feeTier, setFeeTier] = useState<FeeTierKey>('market');
  const [ttl, setTtl] = useState(QUOTE_TTL_SEC);
  const [nonce, setNonce] = useState<string>('');
  const [execErr, setExecErr] = useState<{ code: string; message: string } | null>(null);
  const [result, setResult] = useState<TradeExecuteResult | null>(null);
  const reqId = useRef(0);

  const fetchQuote = useCallback(async () => {
    const id = ++reqId.current;
    setQuoting(true);
    setQuoteErr(null);
    try {
      const { quote: q } = await tradeQuote(params);
      if (id === reqId.current) {
        setQuote(q);
        setTtl(QUOTE_TTL_SEC);
      }
    } catch (e) {
      if (id === reqId.current) {
        setQuote(null);
        setQuoteErr(e instanceof Error ? e.message : 'Could not fetch a quote.');
      }
    } finally {
      if (id === reqId.current) setQuoting(false);
    }
  }, [params]);

  // Deep-link fallback when the authenticated API isn't reachable.
  const openInBot = useCallback(() => {
    if (!deepLink) return;
    haptic('success');
    const tg = getWebApp();
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(deepLink);
      tg.close();
    } else {
      window.open(deepLink, '_blank');
    }
  }, [deepLink]);

  const goReview = useCallback(() => {
    if (!valid) return;
    if (!apiAvailable()) {
      openInBot();
      return;
    }
    haptic('selection');
    setNonce(makeNonce());
    setQuote(null);
    setFeeTier('market');
    setExecErr(null);
    setResult(null);
    setStep('review');
    void fetchQuote();
  }, [valid, openInBot, fetchQuote]);

  // Quote auto-refresh countdown while reviewing.
  useEffect(() => {
    if (step !== 'review' || !quote) return;
    if (ttl <= 0) {
      void fetchQuote();
      return;
    }
    const id = setTimeout(() => setTtl((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [step, quote, ttl, fetchQuote]);

  const doExecute = useCallback(async () => {
    if (!quote || !nonce) return;
    haptic('success');
    setStep('executing');
    setExecErr(null);
    try {
      const res = await tradeExecute(params, nonce, feeTier);
      setResult(res);
      setStep('done');
      haptic('success');
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'EXECUTION_FAILED';
      setExecErr({ code, message: e instanceof Error ? e.message : 'Execution failed.' });
      setStep('done');
      haptic('error');
    }
  }, [quote, nonce, params, feeTier]);

  // Native MainButton mirrors the active CTA inside Telegram.
  useEffect(() => {
    if (!isTMA()) return;
    if (step === 'build' && valid) {
      return showMainButton(t('trade.reviewInChat', { lev: leverage, side: t(`trade.${side}`) }), goReview);
    }
    if (step === 'review' && quote && !quoting) {
      return showMainButton(t('trade.review.confirmSign'), doExecute);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, valid, quote, quoting, leverage, side, market, amount]);

  // ── Builder (step 1) ──────────────────────────────────────────────────
  const fill = ((leverage - minLev) / (maxLev - minLev)) * 100;
  const exposure = valid ? fmt(amt * leverage) : null;

  if (step === 'build') {
    return (
      <AppShell title={t('trade.title')} subtitle={t('trade.subtitle')}>
        <div className="stagger flex flex-col gap-3.5">
          <div className="grid grid-cols-2 gap-2.5">
            {MARKETS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  haptic('selection');
                  setMarket(m);
                }}
                className={`glass glass-press p-4 text-left ${
                  market === m ? 'border-[rgba(124, 92, 255,0.45)] bg-[var(--mint-dim)]' : ''
                }`}
              >
                <p className="text-display text-[17px] font-semibold">{m}</p>
                <p className="mt-0.5 text-[11px] text-mut">
                  {t('trade.upTo', {
                    n: m === market && !isLong ? RISK_PARAMS.MAX_LEVERAGE_SHORT : RISK_PARAMS.MAX_LEVERAGE_LONG,
                  })}
                </p>
              </button>
            ))}
          </div>

          <div className="glass flex gap-1 p-1">
            {(['long', 'short'] as const).map((s) => {
              const active = side === s;
              const Icon = s === 'long' ? TrendingUp : TrendingDown;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    haptic('selection');
                    setSide(s);
                  }}
                  className={`glass-press flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-2.5 text-[14px] font-medium capitalize transition-colors ${
                    active
                      ? s === 'long'
                        ? 'bg-[var(--mint-dim)] text-mint'
                        : 'bg-[rgba(255, 90, 95,0.12)] text-danger'
                      : 'text-mut'
                  }`}
                >
                  <Icon className="h-4 w-4" /> {t(`trade.${s}`)}
                </button>
              );
            })}
          </div>

          <Card>
            <div className="flex items-baseline justify-between">
              <span className="text-[12px] uppercase tracking-wide text-mut">{t('trade.leverage')}</span>
              <span className="text-display text-[24px] font-semibold text-gradient">{leverage.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              className="lever mt-4"
              min={minLev}
              max={maxLev}
              step={0.1}
              value={leverage}
              style={{ ['--fill' as string]: `${fill}%` }}
              onChange={(e) => {
                haptic('selection');
                setLeverage(parseFloat(e.target.value));
              }}
            />
            <div className="mt-1.5 flex justify-between text-[11px] text-mut">
              <span>{minLev}x</span>
              <span>{t('trade.maxSuffix', { n: maxLev, side: t(`trade.${side}`) })}</span>
            </div>
          </Card>

          <Card>
            <label htmlFor="amt" className="text-[12px] uppercase tracking-wide text-mut">
              {t('trade.collateral', { market })}
            </label>
            <div className="mt-2 flex items-center gap-2">
              <input
                id="amt"
                inputMode="decimal"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                className="text-display w-full bg-transparent text-[28px] font-semibold outline-none placeholder:text-[rgba(255,255,255,0.18)]"
              />
              <span className="text-[13px] font-medium text-mut">{market}</span>
            </div>
            {exposure && (
              <p className="mt-2 text-[12px] text-mut">
                {t('trade.totalExposure')} <span className="text-mint">{exposure} {market}</span>
              </p>
            )}
          </Card>

          <Button onClick={goReview} disabled={!valid} className="mt-1">
            {t('trade.reviewConfirm')} <ArrowRight className="h-4 w-4" />
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-center text-[11.5px] text-mut">
            <ShieldCheck className="h-3.5 w-3.5 text-mint" />
            {t('trade.confirmNote')}
          </p>
        </div>
      </AppShell>
    );
  }

  // ── Review (screen 2) + gas detail (screen 3) ─────────────────────────
  if (step === 'review') {
    const minReceived = quote ? quote.exposure * (1 - quote.slippagePct / 100) : 0;
    const tiers = quote?.gas.tiers ?? [];
    const selectedTier = tiers.find((tt) => tt.key === feeTier) ?? tiers.find((tt) => tt.key === 'market') ?? tiers[0] ?? null;
    const tierCost = (tr: { estCostUsd: number | null; estCostEth: number }) =>
      tr.estCostUsd != null ? `~$${fmt(tr.estCostUsd, 2)}` : `~${fmt(tr.estCostEth, 5)} ETH`;
    return (
      <AppShell>
        <div className="stagger flex flex-col gap-3.5">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                haptic('selection');
                setStep('build');
              }}
              className="glass-press -ml-1 flex h-9 w-9 items-center justify-center rounded-full text-mut"
              aria-label="Back"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h1 className="text-display text-[17px] font-semibold">{t('trade.review.title')}</h1>
            <button
              type="button"
              onClick={() => {
                haptic('selection');
                void fetchQuote();
              }}
              className="glass-press flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-[12px] font-semibold text-cyan"
              aria-label={t('trade.review.refresh')}
            >
              {quoting ? <Loader2 className="h-4 w-4 animate-spin" /> : `${ttl}s`}
            </button>
          </div>

          <Card>
            <p className="text-display text-[19px] font-semibold">
              {t('trade.review.heading', { side: t(`trade.${side}`), market, lev: leverage })}
            </p>
          </Card>

          {quoteErr && !quote && (
            <Card>
              <div className="flex items-start gap-2 text-[13px] text-warn">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{quoteErr}</span>
              </div>
              <Button variant="ghost" onClick={() => void fetchQuote()} className="mt-3">
                {t('trade.review.refresh')}
              </Button>
            </Card>
          )}

          {!quote && quoting && !quoteErr && (
            <Card>
              <p className="flex items-center gap-2 text-[13px] text-mut">
                <Loader2 className="h-4 w-4 animate-spin" /> {t('trade.review.quoting')}
              </p>
            </Card>
          )}

          {quote && (
            <>
              {/* You pay → you get */}
              <div className="relative flex flex-col gap-2.5">
                <Card>
                  <p className="text-[12px] text-mut">{t('trade.review.youPay')}</p>
                  <p className="text-display mt-0.5 text-[22px] font-semibold">
                    {fmt(quote.collateral)} {quote.collateralToken}
                  </p>
                </Card>
                <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--card)] bg-[var(--mint-dim)]">
                    <ArrowDown className="h-4 w-4 text-mint" />
                  </div>
                </div>
                <Card>
                  <p className="text-[12px] text-mut">{t('trade.review.youGet')}</p>
                  <p className="text-display mt-0.5 text-[22px] font-semibold text-gradient">
                    {fmt(quote.exposure)} {quote.market}
                  </p>
                  <p className="mt-0.5 text-[12px] text-mut">{t('trade.review.leverageNote', { lev: quote.leverage })}</p>
                </Card>
              </div>

              {/* Real, on-chain-derived details only (no fabricated rows) */}
              <Card className="flex flex-col gap-0">
                <Row label={t('trade.review.entryPrice')} value={`$${fmt(Number(quote.executionPrice), 2)}`} />
                <Divider />
                <Row label={t('trade.review.positionSize')} value={`${fmt(quote.collateralAfter)} ${quote.market}`} />
                <Divider />
                <Row label={t('trade.review.borrowed')} value={`${fmt(quote.debtAfter, 2)} fxUSD`} />
                <Divider />
                <Row label={t('trade.review.slippage')} value={`${quote.slippagePct.toFixed(2)}%`} />
                <Divider />
                <Row
                  label={t('trade.review.mev')}
                  value={
                    <span className={quote.mevProtection === 'on' ? 'text-mint' : 'text-warn'}>
                      {quote.mevProtection === 'on' ? t('trade.review.on') : t('trade.review.off')}
                    </span>
                  }
                />
                <Divider />
                {/* Network fee → expands the real Slow/Market/Fast picker (screen 3) */}
                <button
                  type="button"
                  onClick={() => {
                    haptic('selection');
                    setGasOpen((o) => !o);
                  }}
                  className="flex items-center justify-between py-2.5 text-left"
                >
                  <span className="flex items-center gap-1.5 text-[13px] text-mut">
                    <Fuel className="h-3.5 w-3.5" /> {t('trade.review.networkFee')}
                  </span>
                  <span className="flex items-center gap-1 text-[13px] font-semibold">
                    {selectedTier ? tierCost(selectedTier) : '—'}
                    <span className="text-[11px] font-normal text-mut">({t(`trade.gas.tier.${feeTier}`)})</span>
                    <ChevronDown className={`h-4 w-4 text-mut transition-transform ${gasOpen ? 'rotate-180' : ''}`} />
                  </span>
                </button>
                {gasOpen && (
                  <div className="mt-1 rounded-2xl bg-[rgba(255,255,255,0.03)] p-3">
                    <p className="text-[11px] uppercase tracking-wide text-mut">{t('trade.gas.speedTitle')}</p>
                    {/* Speed tiers — pick one; the server re-derives and broadcasts the chosen tier */}
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {tiers.map((tr) => {
                        const active = tr.key === feeTier;
                        return (
                          <button
                            key={tr.key}
                            type="button"
                            onClick={() => {
                              haptic('selection');
                              setFeeTier(tr.key);
                            }}
                            className={`glass-press flex flex-col items-center gap-0.5 rounded-2xl border px-2 py-2.5 text-center transition-colors ${
                              active ? 'border-[rgba(124,92,255,0.5)] bg-[var(--mint-dim)]' : 'border-transparent'
                            }`}
                          >
                            <span className={`text-[12px] font-semibold ${active ? 'text-mint' : 'text-text'}`}>
                              {t(`trade.gas.tier.${tr.key}`)}
                            </span>
                            <span className="text-[11px] text-mut">
                              {tr.estCostUsd != null ? `$${fmt(tr.estCostUsd, 2)}` : `${fmt(tr.estCostEth, 4)} Ξ`}
                            </span>
                            <span className="text-[10px] text-mut">{fmt(tr.priorityGwei, 2)} gwei</span>
                          </button>
                        );
                      })}
                    </div>
                    {selectedTier && (
                      <div className="mt-3 flex flex-col gap-0">
                        <Row small label={t('trade.gas.maxBaseFee')} value={`${fmt(selectedTier.maxFeeGwei, 2)} gwei`} />
                        <Row small label={t('trade.gas.priorityFee')} value={`${fmt(selectedTier.priorityGwei, 2)} gwei`} />
                        <Row small label={t('trade.gas.gasLimit')} value={Number(quote.gas.units).toLocaleString('en-US')} />
                        <Row
                          small
                          label={t('trade.gas.maxCost')}
                          value={
                            selectedTier.estCostUsd != null
                              ? `$${fmt(selectedTier.estCostUsd, 2)} (${fmt(selectedTier.estCostEth, 5)} ETH)`
                              : `${fmt(selectedTier.estCostEth, 6)} ETH`
                          }
                        />
                      </div>
                    )}
                    <p className="mt-2 text-[11px] leading-snug text-mut">{t('trade.gas.tierNote')}</p>
                  </div>
                )}
                <Divider />
                <Row label={t('trade.review.minReceived')} value={`≥ ${fmt(minReceived)} ${quote.market}`} />
              </Card>

              <Button onClick={doExecute} className="mt-1">
                <ShieldCheck className="h-4 w-4" /> {t('trade.review.confirmSign')}
              </Button>
              <p className="text-center text-[11.5px] leading-snug text-mut">{t('trade.review.honestNote')}</p>
            </>
          )}
        </div>
      </AppShell>
    );
  }

  // ── Executing ─────────────────────────────────────────────────────────
  if (step === 'executing') {
    return (
      <AppShell>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
          <div className="relative flex h-24 w-24 items-center justify-center">
            <div className="absolute inset-0 rounded-full border-2 border-[var(--mint-dim)]" />
            <Loader2 className="h-12 w-12 animate-spin text-mint" />
          </div>
          <p className="text-display text-[18px] font-semibold">{t('trade.exec.signing')}</p>
          <p className="max-w-[260px] text-[13px] text-mut">{t('trade.exec.signingNote')}</p>
        </div>
      </AppShell>
    );
  }

  // ── Done (screen 5) — success or honest failure ───────────────────────
  const failed = !!execErr || (result && !result.ok);
  const isGateOff = execErr?.code === 'BOT_TRADING_OFF';
  const txHash = result?.txHash ?? null;
  const statusLabel = result
    ? result.status.toLowerCase().includes('confirm')
      ? t('trade.result.confirmed')
      : t('trade.result.broadcast')
    : '';
  const statusConfirmed = !!result && result.status.toLowerCase().includes('confirm');

  return (
    <AppShell>
      <div className="flex flex-col items-center gap-5 pt-4 text-center">
        {failed ? (
          <>
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[rgba(255,90,95,0.12)]">
              <AlertTriangle className="h-11 w-11 text-danger" />
            </div>
            <div>
              <p className="text-display text-[22px] font-semibold">{t('trade.result.failedTitle')}</p>
              <p className="mt-1.5 max-w-[300px] text-[13px] text-mut">{execErr?.message}</p>
            </div>
            <div className="flex w-full flex-col gap-2.5">
              {isGateOff ? (
                <>
                  <Button onClick={() => router.push('/settings')}>{t('trade.result.enableTrading')}</Button>
                  <p className="text-[11.5px] text-mut">{t('trade.result.enableNote')}</p>
                </>
              ) : (
                <Button onClick={() => setStep('review')}>{t('trade.result.tryAgain')}</Button>
              )}
              <Button variant="ghost" onClick={() => setStep('build')}>
                {t('trade.result.done')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="relative flex h-28 w-28 items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-[var(--mint-dim)] blur-xl" />
              <div className="relative flex h-24 w-24 items-center justify-center rounded-full border-2 border-mint bg-[var(--card)]">
                <Check className="h-12 w-12 text-mint" strokeWidth={2.5} />
              </div>
            </div>
            <div>
              <p className="text-display text-[24px] font-semibold">{t('trade.result.opened')}</p>
              <p className="mt-1 text-[13px] text-mut">
                {t('trade.result.summary', { market, lev: leverage, amount: fmt(amt), token: market })}
              </p>
              {result?.deduped && <p className="mt-1 text-[12px] text-warn">{t('trade.result.deduped')}</p>}
            </div>

            <Card className="w-full">
              <Row
                label={t('trade.result.transaction')}
                value={
                  txHash ? (
                    <a
                      href={`https://etherscan.io/tx/${txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-cyan"
                    >
                      {shortHash(txHash)} <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    '—'
                  )
                }
              />
              <Divider />
              <Row
                label={t('trade.result.status')}
                value={
                  <span className="flex items-center gap-1.5">
                    {statusLabel}
                    <span className={`h-2 w-2 rounded-full ${statusConfirmed ? 'bg-mint' : 'bg-warn'}`} />
                  </span>
                }
              />
            </Card>

            {/* Real on-chain receipt detail — only shown once the chain confirms */}
            {result?.receipt && (
              <Card className="w-full">
                <Row
                  label={t('trade.result.block')}
                  value={
                    <a
                      href={`https://etherscan.io/block/${result.receipt.blockNumber}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-cyan"
                    >
                      #{result.receipt.blockNumber.toLocaleString('en-US')} <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  }
                />
                <Divider />
                <Row
                  label={t('trade.result.gasPaid')}
                  value={
                    result.receipt.gasPaidUsd != null
                      ? `$${fmt(result.receipt.gasPaidUsd, 2)} (${fmt(result.receipt.gasPaidEth, 5)} ETH)`
                      : `${fmt(result.receipt.gasPaidEth, 6)} ETH`
                  }
                />
                <Divider />
                <Row
                  label={t('trade.result.confirmations')}
                  value={result.receipt.confirmations.toLocaleString('en-US')}
                />
              </Card>
            )}

            {/* Honest progress: Submitted → Broadcast → Confirmed */}
            <div className="flex w-full items-center justify-between px-2">
              {[t('trade.result.submitted'), t('trade.result.broadcast'), t('trade.result.confirmed')].map((s, i) => {
                const lit = statusConfirmed || i < 2;
                return (
                  <div key={s} className="flex flex-1 flex-col items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 rounded-full ${lit ? 'bg-mint' : 'bg-[rgba(255,255,255,0.15)]'}`} />
                    <span className={`text-[11px] ${lit ? 'text-text' : 'text-mut'}`}>{s}</span>
                  </div>
                );
              })}
            </div>

            <div className="flex w-full flex-col gap-2.5">
              {txHash && (
                <a
                  href={`https://etherscan.io/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="glass glass-press flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-[15px] text-[var(--text)]"
                >
                  <ExternalLink className="h-4 w-4" /> {t('trade.result.viewEtherscan')}
                </a>
              )}
              <Button
                onClick={() => {
                  setStep('build');
                  setAmount('');
                }}
              >
                {t('trade.result.done')}
              </Button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Row({
  label,
  value,
  small,
}: {
  label: string;
  value: React.ReactNode;
  small?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between ${small ? 'py-1.5' : 'py-2.5'}`}>
      <span className={`text-mut ${small ? 'text-[12px]' : 'text-[13px]'}`}>{label}</span>
      <span className={`font-semibold ${small ? 'text-[12px]' : 'text-[13px]'}`}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="h-px w-full bg-[rgba(255,255,255,0.06)]" />;
}

export default function TradePage() {
  return (
    <Suspense fallback={<FullScreenSpinner />}>
      <TradeContent />
    </Suspense>
  );
}
