import { USD_PRICE_ASSET_COUNT, USD_PRICE_CACHE_MAX_AGE_MS, type UsdPriceSnapshot, type UsdPriceUpdate } from './prices';
import type { FxTokenKey } from './fx/tokens';

/** Merge display-only quote batches without erasing independently fresh prices.
 * Retained quotes keep their original timestamps; a refresh never renews them.
 */
export function mergeUsdPriceUpdate(current: UsdPriceSnapshot, incoming: UsdPriceUpdate, now = Date.now()): UsdPriceSnapshot {
  const prices: UsdPriceSnapshot['prices'] = {};
  const updatedAts: NonNullable<UsdPriceSnapshot['updatedAts']> = {};
  for (const source of [current, incoming]) {
    for (const key of Object.keys(source.prices) as FxTokenKey[]) {
      const price = source.prices[key];
      const timestamp = source.updatedAts ? source.updatedAts[key] : source.updatedAt;
      if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0
        || typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0
        || now - timestamp > USD_PRICE_CACHE_MAX_AGE_MS || timestamp > now + 30_000) continue;
      if (updatedAts[key] !== undefined && updatedAts[key]! > timestamp) continue;
      prices[key] = price;
      updatedAts[key] = timestamp;
    }
  }
  const times = Object.values(updatedAts) as number[];
  return {
    prices, updatedAts,
    updatedAt: times.length ? Math.min(...times) : null,
    status: times.length === USD_PRICE_ASSET_COUNT ? 'ready' : times.length ? 'partial' : 'unavailable',
  };
}

export function priceRefreshDelay(status: UsdPriceSnapshot['status']): number {
  return status === 'unavailable' ? 6_000 : status === 'partial' || status === 'stale' ? 12_000 : 30_000;
}

/** The polling lifetime is independent of quote publication. Schedule after
 * settlement, including unchanged/failed results, and abort only on disposal.
 */
export function startPriceRefreshLoop<Timer>({ refresh, getStatus, isActive, schedule, cancel }: {
  refresh: (signal: AbortSignal) => Promise<void>;
  getStatus: () => UsdPriceSnapshot['status'];
  isActive: () => boolean;
  schedule: (callback: () => void, delay: number) => Timer;
  cancel: (timer: Timer) => void;
}): () => void {
  let stopped = false;
  let timer: Timer | null = null;
  let controller: AbortController | null = null;
  const arm = () => {
    if (!stopped && isActive()) timer = schedule(() => { void tick(); }, priceRefreshDelay(getStatus()));
  };
  const tick = async () => {
    timer = null;
    if (stopped || !isActive()) return;
    controller = new AbortController();
    try {
      await refresh(controller.signal);
    } catch {
      // The provider reports the failure. Keep its next retry alive even if
      // status and quote timestamps have not changed since the last attempt.
    } finally {
      controller = null;
      arm();
    }
  };
  arm();
  return () => {
    stopped = true;
    if (timer !== null) cancel(timer);
    controller?.abort();
  };
}
