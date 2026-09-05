'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { FxTokenKey } from '@/lib/fx/tokens';
import {
  createCoinbaseTickerController,
  isLiveQuoteFresh,
  LIVE_QUOTE_MAX_AGE_MS,
  type LiveMarketStatus,
  type LiveQuote,
} from '@/lib/liveMarket';
import type { MarketSymbol } from '@/lib/marketData';
import {
  fetchUsdPrices,
  parseUsdPriceCache,
  USD_PRICE_CACHE_KEY,
  USD_PRICE_ASSET_COUNT,
  type UsdPriceSnapshot,
} from '@/lib/prices';

const REFRESH_INTERVAL_MS = 30_000;
const PARTIAL_RETRY_MS = 12_000;
const UNAVAILABLE_RETRY_MS = 6_000;
type PriceContextValue = UsdPriceSnapshot & {
  refreshing: boolean;
  refresh: () => Promise<void>;
  quotes: Partial<Record<MarketSymbol, LiveQuote>>;
  marketStatus: Partial<Record<MarketSymbol, LiveMarketStatus>>;
  liveNow: number;
};
const EMPTY_SNAPSHOT: UsdPriceSnapshot = { prices: {}, status: 'loading', updatedAt: null };
const PriceContext = createContext<PriceContextValue>({
  ...EMPTY_SNAPSHOT,
  refreshing: false,
  refresh: async () => undefined,
  quotes: {},
  marketStatus: {},
  liveNow: 0,
});

function readCachedSnapshot(): UsdPriceSnapshot | null {
  try {
    const raw = window.localStorage.getItem(USD_PRICE_CACHE_KEY);
    if (!raw) return null;
    const cached = parseUsdPriceCache(JSON.parse(raw));
    return cached ? { ...cached, status: 'stale' } : null;
  } catch {
    return null;
  }
}

function writeCachedSnapshot(snapshot: Pick<UsdPriceSnapshot, 'prices' | 'updatedAt'>): void {
  try {
    window.localStorage.setItem(USD_PRICE_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // Private browsing or an embedded host may deny storage. Live fetching
    // remains fully functional without the availability cache.
  }
}

async function fetchWithRetry(signal?: AbortSignal) {
  try {
    return await fetchUsdPrices(fetch, signal);
  } catch (firstFailure) {
    if (signal?.aborted) throw firstFailure;
    await new Promise<void>((resolve, reject) => {
      const abort = () => { window.clearTimeout(timer); reject(signal?.reason); };
      const timer = window.setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 600);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
    return fetchUsdPrices(fetch, signal);
  }
}

export default function PriceProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<UsdPriceSnapshot>(EMPTY_SNAPSHOT);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [quotes, setQuotes] = useState<Partial<Record<MarketSymbol, LiveQuote>>>({});
  const [marketStatus, setMarketStatus] = useState<Partial<Record<MarketSymbol, LiveMarketStatus>>>({});
  const [liveNow, setLiveNow] = useState(() => Date.now());
  const [foreground, setForeground] = useState(false);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const refreshing = useRef<{ signal?: AbortSignal } | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if ((refreshing.current && !refreshing.current.signal?.aborted) || signal?.aborted) return;
    const request = { signal };
    refreshing.current = request;
    setIsRefreshing(true);
    try {
      const next = await fetchWithRetry(signal);
      if (signal?.aborted) return;
      writeCachedSnapshot(next);
      setSnapshot({ ...next, status: Object.keys(next.prices).length === USD_PRICE_ASSET_COUNT ? 'ready' : 'partial' });
    } catch (cause) {
      if (signal?.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) return;
      setSnapshot((current) => ({
        ...current,
        status: Object.keys(current.prices).length > 0 ? 'stale' : 'unavailable',
      }));
    } finally {
      if (refreshing.current === request) {
        refreshing.current = null;
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    let controller: AbortController | null = null;
    const cached = readCachedSnapshot();
    if (cached) setSnapshot(cached);
    const onVisibility = () => {
      controller?.abort();
      controller = null;
      if (document.visibilityState === 'visible' && navigator.onLine) {
        controller = new AbortController();
        void refresh(controller.signal);
      }
    };
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onVisibility);
    window.addEventListener('offline', onVisibility);
    return () => {
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onVisibility);
      window.removeEventListener('offline', onVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    if (!foreground) return undefined;
    const controller = new AbortController();
    const delay = snapshot.status === 'unavailable'
      ? UNAVAILABLE_RETRY_MS
      : snapshot.status === 'partial' || snapshot.status === 'stale'
        ? PARTIAL_RETRY_MS
        : REFRESH_INTERVAL_MS;
    const timer = window.setTimeout(() => {
      if (document.visibilityState === 'visible' && navigator.onLine !== false) void refresh(controller.signal);
    }, delay);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [foreground, refresh, snapshot.status, snapshot.updatedAt]);

  // One public Coinbase socket serves both instruments. It is foreground-only
  // so a Telegram WebView or background browser tab never holds a live stream
  // open. The validated HTTP snapshot remains the anchor and fallback.
  useEffect(() => {
    const active = () => document.visibilityState === 'visible' && navigator.onLine !== false;
    const onQuote = (quote: LiveQuote) => {
      setLiveNow(Date.now());
      setQuotes((current) => {
        const previous = current[quote.market];
        return previous && quote.sequence <= previous.sequence ? current : { ...current, [quote.market]: quote };
      });
    };
    const liveController = createCoinbaseTickerController({
      getAnchors: () => ({ ETH: snapshotRef.current.prices.ETH, BTC: snapshotRef.current.prices.WBTC }),
      onQuote,
      onStatus: (status) => setMarketStatus((current) => ({ ...current, ETH: status, BTC: status })),
    });
    const sync = () => {
      const isActive = active();
      setForeground(isActive);
      if (isActive) setLiveNow(Date.now());
      liveController.setActive(isActive);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      liveController.stop();
    };
  }, []);

  // Wake the provider once, at the next quote expiry, so stale live values
  // immediately reveal the validated HTTP snapshot. No hidden-tab interval
  // survives because this timer only exists while the page is foregrounded.
  useEffect(() => {
    if (!foreground) return undefined;
    const live = Object.values(quotes).filter((quote): quote is LiveQuote => Boolean(quote));
    if (!live.length) return undefined;
    const expiresAt = Math.min(...live.map((quote) => quote.receivedAt + LIVE_QUOTE_MAX_AGE_MS));
    const timer = window.setTimeout(() => setLiveNow(Date.now()), Math.max(50, expiresAt - Date.now() + 10));
    return () => window.clearTimeout(timer);
  }, [foreground, quotes]);

  const retry = useCallback(async () => { await refresh(); }, [refresh]);
  const effectivePrices = useMemo(() => {
    const next = { ...snapshot.prices };
    const eth = quotes.ETH;
    const btc = quotes.BTC;
    if (foreground && marketStatus.ETH === 'live' && isLiveQuoteFresh(eth, liveNow)) {
      next.ETH = eth.price;
      next.WETH = eth.price;
    }
    if (foreground && marketStatus.BTC === 'live' && isLiveQuoteFresh(btc, liveNow)) next.WBTC = btc.price;
    return next;
  }, [foreground, liveNow, marketStatus, quotes, snapshot.prices]);
  const value = useMemo(() => ({ ...snapshot, prices: effectivePrices, refreshing: isRefreshing, refresh: retry, quotes, marketStatus, liveNow }), [effectivePrices, isRefreshing, liveNow, marketStatus, quotes, retry, snapshot]);
  return <PriceContext.Provider value={value}>{children}</PriceContext.Provider>;
}

export function useUsdPrices(): PriceContextValue {
  return useContext(PriceContext);
}

export function useUsdPrice(key: FxTokenKey | null | undefined): number | undefined {
  const { prices } = useUsdPrices();
  return key ? prices[key] : undefined;
}

export function useLiveMarketQuote(market: MarketSymbol): { quote: LiveQuote | null; status: LiveMarketStatus; isFresh: boolean } {
  const { quotes, marketStatus, liveNow } = useUsdPrices();
  const quote = quotes[market] ?? null;
  return { quote, status: marketStatus[market] ?? 'paused', isFresh: marketStatus[market] === 'live' && isLiveQuoteFresh(quote, liveNow) };
}
