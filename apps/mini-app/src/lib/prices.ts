import { formatUnits } from 'viem';
import { FX_TOKENS, type FxTokenKey } from '@/lib/fx/tokens';

export type PriceStatus = 'loading' | 'ready' | 'partial' | 'stale' | 'unavailable';
export type UsdPriceMap = Partial<Record<FxTokenKey, number>>;

export interface UsdPriceSnapshot {
  prices: UsdPriceMap;
  status: PriceStatus;
  updatedAt: number | null;
}

type LlamaCoin = {
  price?: unknown;
  timestamp?: unknown;
  confidence?: unknown;
};

type LlamaResponse = {
  coins?: Record<string, LlamaCoin>;
};

const PRICE_KEYS = Object.keys(FX_TOKENS) as FxTokenKey[];
export const USD_PRICE_ASSET_COUNT = PRICE_KEYS.length;
const ETH_PRICE_ADDRESS = FX_TOKENS.WETH.address;
const MAX_PRICE_AGE_SECONDS = 15 * 60;
const MIN_CONFIDENCE = 0.5;
export const USD_PRICE_CACHE_KEY = 'fxaeon:usd-prices:v1';
export const USD_PRICE_CACHE_MAX_AGE_MS = 2 * 60 * 1000;
const FALLBACK_CACHE_MS = 60_000;
const FALLBACK_REQUEST_LIMIT = 3;
const FALLBACK_PRIORITY: FxTokenKey[] = ['fxUSD', 'wstETH', 'ETH', 'WBTC', 'USDC', 'USDT', 'stETH', 'WETH', 'fxUSDBasePool', 'fxSAVE'];

function validTimestamp(value: unknown, nowSeconds: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    && nowSeconds - value <= MAX_PRICE_AGE_SECONDS && value - nowSeconds <= 120;
}

function coinId(key: FxTokenKey): string {
  const address = key === 'ETH' ? ETH_PRICE_ADDRESS : FX_TOKENS[key].address;
  return `ethereum:${address.toLowerCase()}`;
}

export const USD_PRICE_ENDPOINT = `https://coins.llama.fi/prices/current/${[
  ...new Set(PRICE_KEYS.map(coinId)),
].join(',')}`;

export function parseUsdPriceResponse(payload: unknown, nowSeconds = Math.floor(Date.now() / 1000)): {
  prices: UsdPriceMap;
  updatedAt: number | null;
} {
  if (!payload || typeof payload !== 'object') throw new Error('Price response is not an object');
  const coins = (payload as LlamaResponse).coins;
  if (!coins || typeof coins !== 'object') throw new Error('Price response has no coins');

  const prices: UsdPriceMap = {};
  let oldestTimestamp = Infinity;
  for (const key of PRICE_KEYS) {
    const coin = coins[coinId(key)];
    const price = Number(coin?.price);
    const timestamp = Number(coin?.timestamp);
    const confidence = Number(coin?.confidence);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (!validTimestamp(timestamp, nowSeconds)) continue;
    if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE || confidence > 1) continue;
    prices[key] = price;
    oldestTimestamp = Math.min(oldestTimestamp, timestamp);
  }

  // Each token is independently validated. An unavailable fxUSD quote must
  // not erase a fresh ETH price; consumers still require every held asset
  // needed for a total, and must never substitute a stablecoin's peg.
  if (Object.keys(prices).length === 0) throw new Error('Price response has no validated prices');
  return { prices, updatedAt: oldestTimestamp * 1000 };
}

export function coinGeckoTokenPriceEndpoint(key: FxTokenKey): string {
  const address = (key === 'ETH' ? ETH_PRICE_ADDRESS : FX_TOKENS[key].address).toLowerCase();
  // The public API currently accepts one contract per request. Requests stay
  // on a fixed host and never contain a wallet address or provider credential.
  return `https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${address}&vs_currencies=usd&include_last_updated_at=true`;
}

export function parseCoinGeckoTokenPriceResponse(payload: unknown, key: FxTokenKey, nowSeconds = Math.floor(Date.now() / 1000)): { price: number; timestamp: number } | null {
  if (!payload || typeof payload !== 'object') return null;
  const address = (key === 'ETH' ? ETH_PRICE_ADDRESS : FX_TOKENS[key].address).toLowerCase();
  const coin = (payload as Record<string, { usd?: unknown; last_updated_at?: unknown }>)[address];
  if (typeof coin?.usd !== 'number' || !Number.isFinite(coin.usd) || coin.usd <= 0 || !validTimestamp(coin.last_updated_at, nowSeconds)) return null;
  return { price: coin.usd, timestamp: coin.last_updated_at };
}

/** Bounded, display-only fallback. No price is used by transaction planning. */
export function createUsdPriceFetcher() {
  const fallbackCache = new Map<string, { checkedAt: number; value: { price: number; timestamp: number } | null }>();
  let providerBackoffUntil = 0;
  return async (request: typeof fetch = fetch, signal?: AbortSignal): Promise<{ prices: UsdPriceMap; updatedAt: number | null }> => {
    const prices: UsdPriceMap = {};
    let oldestTimestamp = Infinity;
    const requestJson = async (url: string) => {
      const timeout = AbortSignal.timeout(8_000);
      return request(url, { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    };
    try {
      const response = await requestJson(USD_PRICE_ENDPOINT);
      if (response.ok) {
        const primary = parseUsdPriceResponse(await response.json());
        Object.assign(prices, primary.prices);
        oldestTimestamp = primary.updatedAt! / 1000;
      }
    } catch {
      // A partial or failed primary feed does not make a different token's
      // independently validated fallback price an execution authority.
    }
    signal?.throwIfAborted();
    let requests = 0;
    for (const key of FALLBACK_PRIORITY) {
      if (prices[key]) continue;
      const id = coinId(key);
      const now = Date.now();
      let cached = fallbackCache.get(id);
      if ((!cached || now - cached.checkedAt >= FALLBACK_CACHE_MS) && requests < FALLBACK_REQUEST_LIMIT && now >= providerBackoffUntil) {
        requests += 1;
        let value: { price: number; timestamp: number } | null = null;
        try {
          const response = await requestJson(coinGeckoTokenPriceEndpoint(key));
          if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after');
            const seconds = retryAfter ? Number(retryAfter) : NaN;
            const retryMs = Number.isFinite(seconds) ? seconds * 1000 : retryAfter ? Date.parse(retryAfter) - now : 0;
            providerBackoffUntil = now + Math.max(120_000, Number.isFinite(retryMs) ? retryMs : 0);
          }
          if (response.ok) value = parseCoinGeckoTokenPriceResponse(await response.json(), key);
        } catch { /* Preserve the partial snapshot when this optional feed fails. */ }
        signal?.throwIfAborted();
        cached = { checkedAt: now, value };
        fallbackCache.set(id, cached);
      }
      if (cached?.value && validTimestamp(cached.value.timestamp, Math.floor(Date.now() / 1000))) {
        prices[key] = cached.value.price;
        oldestTimestamp = Math.min(oldestTimestamp, cached.value.timestamp);
      }
    }
    signal?.throwIfAborted();
    if (Object.keys(prices).length === 0) throw new Error('Price services have no validated prices');
    return { prices, updatedAt: oldestTimestamp * 1000 };
  };
}

export const fetchUsdPrices = createUsdPriceFetcher();

/**
 * Local storage is an availability aid, not a second price oracle. Only a
 * recently validated snapshot is accepted, and every value is re-checked
 * before it can reach the UI. The provider always refreshes it immediately.
 */
export function parseUsdPriceCache(
  payload: unknown,
  nowMs = Date.now(),
): { prices: UsdPriceMap; updatedAt: number } | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as { prices?: unknown; updatedAt?: unknown };
  const updatedAt = Number(candidate.updatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return null;
  if (updatedAt - nowMs > 120_000 || nowMs - updatedAt > USD_PRICE_CACHE_MAX_AGE_MS) return null;
  if (!candidate.prices || typeof candidate.prices !== 'object') return null;

  const prices: UsdPriceMap = {};
  for (const key of PRICE_KEYS) {
    const value = Number((candidate.prices as Partial<Record<FxTokenKey, unknown>>)[key]);
    if (Number.isFinite(value) && value > 0) prices[key] = value;
  }
  if (Object.keys(prices).length === 0) return null;
  return { prices, updatedAt };
}

export function priceKeyForSymbol(symbol: string): FxTokenKey | null {
  const normalised = symbol.replace(/\s+/g, '').toLowerCase();
  if (normalised === 'eth') return 'ETH';
  if (normalised === 'weth') return 'WETH';
  if (normalised === 'steth') return 'stETH';
  if (normalised === 'wsteth') return 'wstETH';
  if (normalised === 'btc' || normalised === 'wbtc') return 'WBTC';
  if (normalised === 'usdc') return 'USDC';
  if (normalised === 'usdt') return 'USDT';
  if (normalised === 'fxusd') return 'fxUSD';
  if (normalised === 'fxsave') return 'fxSAVE';
  if (normalised === 'fxusdbasepool' || normalised === 'basepool' || normalised === 'fxsp') return 'fxUSDBasePool';
  return null;
}

export function usdValueForDecimal(value: string, price: number | undefined): number | null {
  if (!price || !Number.isFinite(price) || price <= 0 || value.toLowerCase() === 'all') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const usd = amount * price;
  return Number.isFinite(usd) ? usd : null;
}

export function usdValueForUnits(value: bigint, decimals: number, price: number | undefined): number | null {
  return usdValueForDecimal(formatUnits(value, decimals), price);
}

export function formatUsd(value: number | null | undefined, maximumFractionDigits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value > 0 && value < 0.01) return '<$0.01';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits,
  }).format(value);
}

export function formatUsdPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const digits = value >= 1000 ? 2 : value >= 1 ? 2 : 4;
  return formatUsd(value, digits);
}
