'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Activity, BarChart3, ChevronDown, RefreshCw } from 'lucide-react';
import TokenIcon from '@/components/TokenIcon';
import { useLiveMarketQuote, useUsdPrices } from '@/components/PriceProvider';
import { fetchMarketHistory, type MarketHistorySnapshot, type MarketRange, type MarketSymbol } from '@/lib/marketData';
import { fetchMarketCandles, liveQuoteCandle, type LiveMarketRange, type MarketCandleSnapshot } from '@/lib/liveMarket';
import { formatUsdPrice } from '@/lib/prices';
import { haptic } from '@/lib/telegram';
import styles from '@/components/trade-surfaces.module.css';

type HistoryState = { status: 'loading' | 'ready' | 'unavailable'; snapshot: MarketHistorySnapshot | null };
const historyCache = new Map<string, { snapshot: MarketHistorySnapshot; storedAt: number }>();
const candleCache = new Map<string, { snapshot: MarketCandleSnapshot; storedAt: number }>();
const RANGE_OPTIONS: LiveMarketRange[] = ['1H', '1D', '7D', '30D'];

function boundedSignal(signal: AbortSignal, timeoutMs = 15_000): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}

export function useMarketHistory(market: MarketSymbol, range: MarketRange): HistoryState & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<HistoryState>({ status: 'loading', snapshot: null });
  useEffect(() => {
    let active = true;
    const key = `${market}:${range}`;
    const cached = historyCache.get(key);
    if (cached && Date.now() - cached.storedAt < 90_000) setState({ status: 'ready', snapshot: cached.snapshot });
    else setState({ status: 'loading', snapshot: null });
    const controller = new AbortController();
    void fetchMarketHistory(market, range, fetch, boundedSignal(controller.signal)).then((snapshot) => {
      if (!active) return;
      historyCache.set(key, { snapshot, storedAt: Date.now() });
      setState({ status: 'ready', snapshot });
    }).catch(() => { if (active) setState((current) => current.snapshot ? current : { status: 'unavailable', snapshot: null }); });
    return () => { active = false; controller.abort(); };
  }, [attempt, market, range]);
  return { ...state, retry: () => setAttempt((value) => value + 1) };
}

function useLiveCandles(market: MarketSymbol, range: LiveMarketRange, enabled: boolean) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'unavailable'; snapshot: MarketCandleSnapshot | null }>({ status: 'loading', snapshot: null });
  const baseSnapshotRef = useRef<MarketCandleSnapshot | null>(null);
  const live = useLiveMarketQuote(market);
  useEffect(() => {
    let active = true;
    const key = `${market}:${range}`;
    const cached = candleCache.get(key);
    if (!enabled) return () => undefined;
    if (cached && Date.now() - cached.storedAt < 90_000) {
      baseSnapshotRef.current = cached.snapshot;
      setState({ status: 'ready', snapshot: cached.snapshot });
    } else { baseSnapshotRef.current = null; setState({ status: 'loading', snapshot: null }); }
    const controller = new AbortController();
    void fetchMarketCandles(market, range, fetch, controller.signal).then((snapshot) => {
      if (!active) return;
      baseSnapshotRef.current = snapshot;
      candleCache.set(key, { snapshot, storedAt: Date.now() });
      setState({ status: 'ready', snapshot });
    }).catch(() => { if (active) setState((current) => current.snapshot ? current : { status: 'unavailable', snapshot: null }); });
    return () => { active = false; controller.abort(); };
  }, [attempt, enabled, market, range]);
  const baseSnapshot = baseSnapshotRef.current;
  let displayedSnapshot = baseSnapshot;
  if (baseSnapshot && live.isFresh && live.quote) {
    const next = liveQuoteCandle(baseSnapshot, live.quote);
    if (next) {
      const candles = baseSnapshot.candles.slice();
      if (candles.at(-1)?.time === next.time) candles[candles.length - 1] = next;
      else candles.push(next);
      const first = candles[0];
      if (first) displayedSnapshot = { ...baseSnapshot, candles, points: candles.map((candle) => ({ timestamp: candle.time * 1_000, price: candle.close })), currentPrice: next.close, high: Math.max(baseSnapshot.high, next.high), low: Math.min(baseSnapshot.low, next.low), percentChange: ((next.close - first.open) / first.open) * 100, updatedAt: live.quote.sourceAt };
    }
  }
  return { ...state, snapshot: enabled ? displayedSnapshot : null, retry: () => setAttempt((value) => value + 1), live };
}

export function TradeMarketChart({ market }: { market: MarketSymbol }) {
  const [range, setRange] = useState<LiveMarketRange>('1D');
  const [isMobile, setIsMobile] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const chartId = useId();
  const expanded = !isMobile || mobileExpanded;
  const history = useLiveCandles(market, range, expanded);
  const { prices } = useUsdPrices();
  const live = useLiveMarketQuote(market);
  const fallbackPrice = prices[market === 'ETH' ? 'ETH' : 'WBTC'];
  const price = live.isFresh ? live.quote?.price : fallbackPrice ?? history.snapshot?.currentPrice;
  const change = live.isFresh ? live.quote?.percentChange24h : history.snapshot?.percentChange;
  const positive = change !== undefined && change >= 0;
  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)');
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return <section className={`${styles.marketChart} market-chart-panel`} aria-label={`${market} market chart`}>
    <header className="market-chart-header">
      <div className="flex min-w-0 items-center gap-3"><span className="market-chart-token"><TokenIcon symbol={market === 'BTC' ? 'WBTC' : 'ETH'} size={34} /></span><div className="min-w-0"><span className="micro-label text-[11px] text-mut">Market</span><h2 className="truncate text-[18px] font-semibold">{market} / USD</h2></div></div>
      <div className="shrink-0 text-right"><p className="text-display text-[24px] font-semibold tabular-nums">{formatUsdPrice(price)}</p><p className={`mt-1 inline-flex items-center gap-1 text-[11px] font-semibold ${change === undefined ? 'text-mut' : positive ? 'text-success' : 'text-danger'}`}>{change === undefined ? 'Change unavailable' : <><span aria-hidden="true">{positive ? '↗' : '↘'}</span>{positive ? '+' : ''}{change.toFixed(2)}% 24h</>}</p></div>
    </header>
    <button type="button" className="market-chart-toggle" aria-expanded={expanded} aria-controls={chartId} onClick={() => { setMobileExpanded((value) => !value); haptic('selection'); }}><BarChart3 className="h-4 w-4" aria-hidden="true" /><span>{expanded ? 'Hide chart' : 'Show chart'}</span><ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" /></button>
    <div id={chartId} className="market-chart-content" hidden={!expanded}><div className="market-chart-frame">
      {history.status === 'loading' && <ChartSkeleton />}
      {history.status === 'unavailable' && <div className="market-chart-empty" role="status"><BarChart3 className="h-6 w-6 text-mut" aria-hidden="true" /><span><strong>Chart temporarily unavailable</strong><small>Trade details are still available.</small></span><button type="button" aria-label="Retry market chart" onClick={history.retry} className="glass-press flex min-h-11 min-w-11 items-center justify-center rounded-lg text-mut"><RefreshCw className="h-4 w-4" aria-hidden="true" /></button></div>}
      {history.status === 'ready' && history.snapshot && <LazyCandlestickChart snapshot={history.snapshot} />}
    </div><footer className="market-chart-footer"><a href={`https://www.coingecko.com/en/coins/${market === 'ETH' ? 'ethereum' : 'bitcoin'}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-[11px] text-mut hover:text-mint"><Activity className="h-3.5 w-3.5 text-mint" aria-hidden="true" />CoinGecko</a><span className="inline-flex min-h-11 items-center gap-1.5 text-[11px] text-mut"><span className="status-dot" aria-hidden="true" />{live.status === 'live' && live.isFresh ? 'Live market' : 'Price updates paused'}</span><div role="radiogroup" aria-label="Chart range" className="chart-range-tabs">{RANGE_OPTIONS.map((option) => <button key={option} type="button" role="radio" aria-checked={range === option} tabIndex={range === option ? 0 : -1} onClick={() => { setRange(option); haptic('selection'); }} onKeyDown={(event) => { const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']; if (!keys.includes(event.key)) return; event.preventDefault(); const current = RANGE_OPTIONS.indexOf(option); const backwards = event.key === 'ArrowLeft' || event.key === 'ArrowUp'; const next = event.key === 'Home' ? 0 : event.key === 'End' ? RANGE_OPTIONS.length - 1 : (current + (backwards ? -1 : 1) + RANGE_OPTIONS.length) % RANGE_OPTIONS.length; setRange(RANGE_OPTIONS[next]); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus(); haptic('selection'); }} className={range === option ? 'chart-range-active' : ''}>{option}</button>)}</div></footer></div>
  </section>;
}

export function MarketMiniCard({ market }: { market: MarketSymbol }) {
  const history = useMarketHistory(market, '1D');
  const { prices } = useUsdPrices();
  const live = useLiveMarketQuote(market);
  const price = live.isFresh ? live.quote?.price : prices[market === 'ETH' ? 'ETH' : 'WBTC'] ?? history.snapshot?.currentPrice;
  const change = live.isFresh ? live.quote?.percentChange24h : history.snapshot?.percentChange;
  const positive = change !== undefined && change >= 0;
  return <div className={`${styles.marketMiniCard} portfolio-market-card`} aria-label={`${market} market overview`}><div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><TokenIcon symbol={market === 'BTC' ? 'WBTC' : 'ETH'} size={28} /><strong className="text-[13px]">{market}</strong></span><span className={`text-[10.5px] font-semibold ${change === undefined ? 'text-mut' : positive ? 'text-success' : 'text-danger'}`}>{change === undefined ? '—' : `${positive ? '+' : ''}${change.toFixed(2)}%`}</span></div><p className="mt-3 text-display text-[20px] font-semibold tabular-nums">{formatUsdPrice(price)}</p><div className="market-chart-compact mt-2 h-[54px]">{history.status === 'ready' && history.snapshot ? <Sparkline snapshot={history.snapshot} /> : <span className="text-[11px] text-mut">Chart unavailable</span>}</div></div>;
}

function LazyCandlestickChart({ snapshot }: { snapshot: MarketCandleSnapshot }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const initialCandlesRef = useRef(snapshot.candles);
  initialCandlesRef.current = snapshot.candles;
  const renderedCandlesRef = useRef<MarketCandleSnapshot['candles']>([]);
  const chartRef = useRef<{ remove: () => void; timeScale: () => { fitContent: () => void } } | null>(null);
  const seriesRef = useRef<{ setData: (data: readonly unknown[]) => void; update: (data: unknown) => void } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void import('lightweight-charts').then(({ createChart, CandlestickSeries }) => {
      if (!active || !hostRef.current) return;
      const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
      const chart = createChart(hostRef.current, {
        autoSize: true,
        layout: { background: { color: 'transparent' }, textColor: css('--mut', '#87909d') },
        grid: { vertLines: { color: css('--line', 'rgba(255,255,255,.08)') }, horzLines: { color: css('--line', 'rgba(255,255,255,.08)') } },
        rightPriceScale: { borderColor: css('--line', 'rgba(255,255,255,.1)') },
        timeScale: { borderColor: css('--line', 'rgba(255,255,255,.1)'), timeVisible: true, secondsVisible: false, rightOffset: 2 },
        crosshair: { vertLine: { color: css('--mint', '#24d399'), width: 1 }, horzLine: { color: css('--mint', '#24d399'), width: 1 } },
      });
      const series = chart.addSeries(CandlestickSeries, { upColor: css('--success', '#24d399'), downColor: css('--danger', '#ff5c73'), borderVisible: false, wickUpColor: css('--success', '#24d399'), wickDownColor: css('--danger', '#ff5c73') });
      chartRef.current = chart;
      seriesRef.current = series as unknown as { setData: (data: readonly unknown[]) => void; update: (data: unknown) => void };
      seriesRef.current.setData(toChartData(initialCandlesRef.current));
      renderedCandlesRef.current = initialCandlesRef.current;
      chart.timeScale().fitContent();
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; chartRef.current?.remove(); chartRef.current = null; seriesRef.current = null; };
  }, []);
  useEffect(() => {
    if (!seriesRef.current) return;
    const previous = renderedCandlesRef.current;
    const next = snapshot.candles;
    const tailOnly = previous.length > 0 && next.length >= previous.length && next.length <= previous.length + 1
      && previous.slice(0, -1).every((candle, index) => candle === next[index]);
    if (tailOnly && next.length) seriesRef.current.update(toChartData(next.slice(-1))[0]);
    else seriesRef.current.setData(toChartData(next));
    renderedCandlesRef.current = next;
  }, [snapshot.candles]);
  if (failed) return <div className="market-chart-empty" role="img" aria-label={`${snapshot.market} ${snapshot.range} USD price chart unavailable`}><BarChart3 className="h-6 w-6 text-mut" aria-hidden="true" /><span><strong>{snapshot.market} price chart</strong><small>Current {formatUsdPrice(snapshot.currentPrice)} · high {formatUsdPrice(snapshot.high)} · low {formatUsdPrice(snapshot.low)}</small></span></div>;
  return <div ref={hostRef} className="market-chart-graphic" role="img" aria-label={`${snapshot.market} ${snapshot.range} USD price chart, current price ${formatUsdPrice(snapshot.currentPrice)}`}><span className="sr-only">High {formatUsdPrice(snapshot.high)}. Low {formatUsdPrice(snapshot.low)}.</span></div>;
}

function toChartData(candles: MarketCandleSnapshot['candles']) {
  return candles.map((candle) => ({
    time: candle.time as import('lightweight-charts').UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));
}

function Sparkline({ snapshot }: { snapshot: MarketHistorySnapshot }) {
  const values = snapshot.points.map((point) => point.price);
  const min = Math.min(...values); const max = Math.max(...values); const span = Math.max(max - min, max * 0.002, 1e-8);
  const coordinates = values.map((value, index) => `${((index / Math.max(1, values.length - 1)) * 100).toFixed(2)},${(8 + ((max - value) / span) * 84).toFixed(2)}`).join(' ');
  const id = `spark-${snapshot.market}`;
  return <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label={`${snapshot.market} 24 hour trend`}><polyline points={coordinates} fill="none" stroke={snapshot.percentChange >= 0 ? 'var(--success)' : 'var(--danger)'} strokeWidth="3" vectorEffect="non-scaling-stroke" /><title id={id}>{snapshot.market} trend</title></svg>;
}

function ChartSkeleton() { return <div role="status" aria-label="Loading market chart" className="market-chart-skeleton h-[220px]"><span /></div>; }
