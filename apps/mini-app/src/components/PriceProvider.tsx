'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { FxTokenKey } from '@/lib/fx/tokens';
import {
  createCoinbaseTickerController,
  isLiveQuoteFresh,
  type LiveMarketStatus,
  type LiveQuote,
} from '@/lib/liveMarket';
import type { MarketSymbol } from '@/lib/marketData';
import { liveMarketStore } from '@/lib/liveMarketStore';
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
};
const EMPTY_SNAPSHOT: UsdPriceSnapshot = { prices: {}, status: 'loading', updatedAt: null };
const EMPTY_LIVE_MARKET = { quote: null, status: 'paused' as const, now: 0 };
const PriceContext = createContext<PriceContextValue>({
  ...EMPTY_SNAPSHOT,
  refreshing: false,
  refresh: async () => undefined,
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
      liveMarketStore.acceptQuote(quote);
    };
    const liveController = createCoinbaseTickerController({
      getAnchors: () => ({ ETH: snapshotRef.current.prices.ETH, BTC: snapshotRef.current.prices.WBTC }),
      onQuote,
      onStatus: (status) => liveMarketStore.setStatus(status),
    });
    const sync = () => {
      const isActive = active();
      setForeground(isActive);
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

  const retry = useCallback(async () => { await refresh(); }, [refresh]);
  const value = useMemo(() => ({ ...snapshot, refreshing: isRefreshing, refresh: retry }), [isRefreshing, retry, snapshot]);
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
  const live = useSyncExternalStore(liveMarketStore.subscribe, () => liveMarketStore.getSnapshot(market), () => EMPTY_LIVE_MARKET);
  const quote = live.quote;
  return { quote, status: live.status, isFresh: live.status === 'live' && isLiveQuoteFresh(quote, live.now) };
}
