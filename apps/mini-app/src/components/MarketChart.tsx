'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Activity, BarChart3, ChevronDown, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import TokenIcon from '@/components/TokenIcon';
import { useUsdPrices } from '@/components/PriceProvider';
import {
  fetchMarketHistory,
  type MarketHistorySnapshot,
  type MarketRange,
  type MarketSymbol,
} from '@/lib/marketData';
import { formatUsdPrice } from '@/lib/prices';
import { haptic } from '@/lib/telegram';

type HistoryState = {
  status: 'loading' | 'ready' | 'unavailable';
  snapshot: MarketHistorySnapshot | null;
};

const historyCache = new Map<string, { snapshot: MarketHistorySnapshot; storedAt: number }>();
const historyRequests = new Map<string, Promise<MarketHistorySnapshot>>();
const HISTORY_CACHE_AGE_MS = 90 * 1000;
const RANGE_OPTIONS: MarketRange[] = ['1D', '7D', '30D'];

function cacheKey(market: MarketSymbol, range: MarketRange): string {
  return `${market}:${range}`;
}

function requestMarketHistory(market: MarketSymbol, range: MarketRange): Promise<MarketHistorySnapshot> {
  const key = cacheKey(market, range);
  const inFlight = historyRequests.get(key);
  if (inFlight) return inFlight;
  const pending = (async () => {
    try {
      return await fetchMarketHistory(market, range);
    } catch {
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      return fetchMarketHistory(market, range);
    }
  })().finally(() => historyRequests.delete(key));
  historyRequests.set(key, pending);
  return pending;
}

export function useMarketHistory(market: MarketSymbol, range: MarketRange): HistoryState & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<HistoryState>(() => {
    const cached = historyCache.get(cacheKey(market, range));
    return cached && Date.now() - cached.storedAt <= HISTORY_CACHE_AGE_MS
      ? { status: 'ready', snapshot: cached.snapshot }
      : { status: 'loading', snapshot: null };
  });

  useEffect(() => {
    let active = true;
    const key = cacheKey(market, range);
    const cached = historyCache.get(key);
    if (cached && Date.now() - cached.storedAt <= HISTORY_CACHE_AGE_MS) {
      setState({ status: 'ready', snapshot: cached.snapshot });
    } else {
      setState({ status: 'loading', snapshot: null });
    }

    const load = async () => {
      try {
        const snapshot = await requestMarketHistory(market, range);
        if (!active) return;
        historyCache.set(key, { snapshot, storedAt: Date.now() });
        setState({ status: 'ready', snapshot });
      } catch {
        if (active) {
          const fallback = historyCache.get(key);
          setState(fallback ? { status: 'ready', snapshot: fallback.snapshot } : { status: 'unavailable', snapshot: null });
        }
      }
    };
    void load();
    return () => { active = false; };
  }, [attempt, market, range]);

  return { ...state, retry: () => setAttempt((current) => current + 1) };
}

export function TradeMarketChart({ market }: { market: MarketSymbol }) {
  const [range, setRange] = useState<MarketRange>('1D');
  const [isMobile, setIsMobile] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const chartId = useId();
  const expanded = !isMobile || mobileExpanded;
  const history = useMarketHistory(market, range);
  const { prices } = useUsdPrices();
  const livePrice = prices[market === 'ETH' ? 'ETH' : 'WBTC'] ?? history.snapshot?.currentPrice;
  const change = history.snapshot?.percentChange;
  const positive = change !== undefined && change >= 0;
  const ChangeIcon = positive ? TrendingUp : TrendingDown;

  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)');
    const updateViewport = () => setIsMobile(media.matches);
    updateViewport();
    media.addEventListener('change', updateViewport);
    return () => media.removeEventListener('change', updateViewport);
  }, []);

  return (
    <section className="market-chart-panel" data-mobile-expanded={mobileExpanded} aria-label={`${market} market chart`}>
      <div className="market-chart-header">
        <div className="flex min-w-0 items-center gap-3">
          <span className="market-chart-token"><TokenIcon symbol={market === 'BTC' ? 'WBTC' : 'ETH'} size={34} /></span>
          <div className="min-w-0">
            <p className="micro-label">f(x) market · Ethereum</p>
            <h2 className="mt-1 truncate text-[18px] font-semibold">{market} / USD</h2>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-display text-[24px] font-semibold tabular-nums">{formatUsdPrice(livePrice)}</p>
          <p className={`mt-1 inline-flex items-center justify-end gap-1 text-[11px] font-semibold ${change === undefined ? 'text-mut' : positive ? 'text-success' : 'text-danger'}`}>
            {change === undefined ? `${range} unavailable` : <><ChangeIcon className="h-3.5 w-3.5" aria-hidden="true" />{positive ? '+' : ''}{change.toFixed(2)}% {range}</>}
          </p>
        </div>
      </div>

      <button
        type="button"
        className="market-chart-toggle"
        aria-expanded={expanded}
        aria-controls={chartId}
        onClick={() => { setMobileExpanded((current) => !current); haptic('selection'); }}
      >
        <BarChart3 className="h-4 w-4" aria-hidden="true" />
        <span>{expanded ? 'Hide chart' : 'Show chart'}</span>
        <ChevronDown className="market-chart-toggle-chevron h-4 w-4" aria-hidden="true" />
      </button>

      <div id={chartId} className="market-chart-content" hidden={!expanded}>
        <div className="market-chart-frame">
          {history.status === 'loading' && <ChartSkeleton />}
          {history.status === 'unavailable' && (
            <div className="market-chart-empty" role="status">
              <BarChart3 className="h-6 w-6 text-mut" aria-hidden="true" />
              <span><strong>Chart temporarily unavailable</strong><small>Live trading controls remain available.</small></span>
              <button type="button" aria-label="Retry market chart" onClick={history.retry} className="glass-press flex min-h-11 min-w-11 items-center justify-center rounded-lg text-mut hover:text-mint"><RefreshCw className="h-4 w-4" /></button>
            </div>
          )}
          {history.status === 'ready' && history.snapshot && <MarketChartGraphic snapshot={history.snapshot} />}
        </div>

        <div className="market-chart-footer">
          <span className="inline-flex items-center gap-1.5 text-[10px] text-mut"><Activity className="h-3.5 w-3.5 text-mint" aria-hidden="true" />CoinGecko history · display only</span>
          <div role="radiogroup" aria-label="Chart range" className="chart-range-tabs">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={range === option}
                onClick={() => { setRange(option); haptic('selection'); }}
                className={range === option ? 'chart-range-active' : ''}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function MarketMiniCard({ market }: { market: MarketSymbol }) {
  const history = useMarketHistory(market, '1D');
  const { prices } = useUsdPrices();
  const price = prices[market === 'ETH' ? 'ETH' : 'WBTC'] ?? history.snapshot?.currentPrice;
  const change = history.snapshot?.percentChange;
  const positive = change !== undefined && change >= 0;
  return (
    <div className="portfolio-market-card" aria-label={`${market} market overview`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2"><TokenIcon symbol={market === 'BTC' ? 'WBTC' : 'ETH'} size={28} /><strong className="text-[13px]">{market}</strong></span>
        <span className={`text-[10.5px] font-semibold ${change === undefined ? 'text-mut' : positive ? 'text-success' : 'text-danger'}`}>{change === undefined ? '—' : `${positive ? '+' : ''}${change.toFixed(2)}%`}</span>
      </div>
      <p className="mt-3 text-display text-[20px] font-semibold tabular-nums">{formatUsdPrice(price)}</p>
      <div className="mt-2 h-[54px]">
        {history.status === 'ready' && history.snapshot
          ? <MarketChartGraphic snapshot={history.snapshot} compact />
          : history.status === 'loading'
            ? <ChartSkeleton compact />
            : <div className="market-chart-mini-empty" role="status"><BarChart3 className="h-4 w-4" aria-hidden="true" /><span>History unavailable</span></div>}
      </div>
    </div>
  );
}

function MarketChartGraphic({ snapshot, compact = false }: { snapshot: MarketHistorySnapshot; compact?: boolean }) {
  const localId = useId().replace(/:/g, '');
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const geometry = useMemo(() => chartGeometry(snapshot.points.map((point) => point.price), compact ? 260 : 640, compact ? 80 : 220), [compact, snapshot.points]);
  const active = activeIndex === null ? null : snapshot.points[activeIndex];
  const activeCoordinate = activeIndex === null ? null : geometry.coordinates[activeIndex];
  const positive = snapshot.percentChange >= 0;
  const stroke = positive ? 'var(--success)' : 'var(--danger)';
  const gradientId = `market-gradient-${localId}-${snapshot.market}-${snapshot.range}-${compact ? 'mini' : 'full'}`;

  return (
    <div className={`market-chart-graphic ${compact ? 'market-chart-compact' : ''}`}>
      <svg
        ref={svgRef}
        role="img"
        aria-label={`${snapshot.market} ${snapshot.range} USD price chart, ${snapshot.percentChange >= 0 ? 'up' : 'down'} ${Math.abs(snapshot.percentChange).toFixed(2)} percent`}
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        preserveAspectRatio="none"
        onPointerMove={compact ? undefined : (event) => {
          const rect = svgRef.current?.getBoundingClientRect();
          if (!rect) return;
          const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
          setActiveIndex(Math.round(fraction * (snapshot.points.length - 1)));
        }}
        onPointerLeave={compact ? undefined : () => setActiveIndex(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {!compact && [0.25, 0.5, 0.75].map((fraction) => <line key={fraction} x1="0" x2={geometry.width} y1={geometry.height * fraction} y2={geometry.height * fraction} className="market-chart-gridline" />)}
        <path d={geometry.areaPath} fill={`url(#${gradientId})`} />
        <path d={geometry.linePath} fill="none" stroke={stroke} strokeWidth={compact ? 3 : 2.5} vectorEffect="non-scaling-stroke" />
        {activeCoordinate && <><line x1={activeCoordinate.x} x2={activeCoordinate.x} y1="0" y2={geometry.height} className="market-chart-crosshair" /><circle cx={activeCoordinate.x} cy={activeCoordinate.y} r="5" fill={stroke} stroke="var(--bg-raised)" strokeWidth="3" vectorEffect="non-scaling-stroke" /></>}
      </svg>
      {active && activeCoordinate && (
        <span className="market-chart-tooltip" style={{ left: `${(activeCoordinate.x / geometry.width) * 100}%`, top: `${Math.max(5, (activeCoordinate.y / geometry.height) * 100 - 16)}%` }}>
          <strong>{formatUsdPrice(active.price)}</strong>
          <small>{new Date(active.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small>
        </span>
      )}
    </div>
  );
}

function chartGeometry(values: number[], width: number, height: number) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, max * 0.002, 1e-8);
  const verticalPadding = height * 0.1;
  const usableHeight = height - verticalPadding * 2;
  const coordinates = values.map((value, index) => ({
    x: values.length === 1 ? width / 2 : (index / (values.length - 1)) * width,
    y: verticalPadding + ((max - value) / span) * usableHeight,
  }));
  const linePath = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
  const areaPath = coordinates.length ? `${linePath} L${width},${height} L0,${height} Z` : '';
  return { width, height, coordinates, linePath, areaPath };
}

function ChartSkeleton({ compact = false }: { compact?: boolean }) {
  return <div role="status" aria-label="Loading market chart" className={`market-chart-skeleton ${compact ? 'h-full' : 'h-[220px]'}`}><span /></div>;
}
