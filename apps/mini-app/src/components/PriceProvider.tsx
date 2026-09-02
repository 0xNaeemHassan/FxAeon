'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { FxTokenKey } from '@/lib/fx/tokens';
import { fetchUsdPrices, type UsdPriceSnapshot } from '@/lib/prices';

const REFRESH_INTERVAL_MS = 30_000;
const EMPTY_SNAPSHOT: UsdPriceSnapshot = { prices: {}, status: 'loading', updatedAt: null };
const PriceContext = createContext<UsdPriceSnapshot>(EMPTY_SNAPSHOT);

export default function PriceProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<UsdPriceSnapshot>(EMPTY_SNAPSHOT);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchUsdPrices(fetch, signal);
      setSnapshot({ ...next, status: 'ready' });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setSnapshot((current) => ({
        ...current,
        status: Object.keys(current.prices).length > 0 ? 'stale' : 'unavailable',
      }));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(controller.signal);
    }, REFRESH_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh(controller.signal);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  const value = useMemo(() => snapshot, [snapshot]);
  return <PriceContext.Provider value={value}>{children}</PriceContext.Provider>;
}

export function useUsdPrices(): UsdPriceSnapshot {
  return useContext(PriceContext);
}

export function useUsdPrice(key: FxTokenKey | null | undefined): number | undefined {
  const { prices } = useUsdPrices();
  return key ? prices[key] : undefined;
}
