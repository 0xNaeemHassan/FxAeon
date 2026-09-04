'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { FxTokenKey } from '@/lib/fx/tokens';
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
const PriceContext = createContext<PriceContextValue>({ ...EMPTY_SNAPSHOT, refreshing: false, refresh: async () => undefined });

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
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    return fetchUsdPrices(fetch, signal);
  }
}

export default function PriceProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<UsdPriceSnapshot>(EMPTY_SNAPSHOT);
  const [isRefreshing, setIsRefreshing] = useState(false);
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
    const controller = new AbortController();
    const cached = readCachedSnapshot();
    if (cached) setSnapshot(cached);
    void refresh(controller.signal);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh(controller.signal);
    };
    const onOnline = () => void refresh(controller.signal);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      controller.abort();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [refresh]);

  useEffect(() => {
    const delay = snapshot.status === 'unavailable'
      ? UNAVAILABLE_RETRY_MS
      : snapshot.status === 'partial' || snapshot.status === 'stale'
        ? PARTIAL_RETRY_MS
        : REFRESH_INTERVAL_MS;
    const timer = window.setTimeout(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) void refresh();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [refresh, snapshot.status, snapshot.updatedAt]);

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
