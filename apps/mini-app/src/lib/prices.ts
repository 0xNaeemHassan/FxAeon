import { formatUnits } from 'viem';
import { FX_TOKENS, type FxTokenKey } from '@/lib/fx/tokens';

export type PriceStatus = 'loading' | 'ready' | 'stale' | 'unavailable';
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
const ETH_PRICE_ADDRESS = FX_TOKENS.WETH.address;
const MAX_PRICE_AGE_SECONDS = 15 * 60;
const MIN_CONFIDENCE = 0.5;

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
  let newestTimestamp = 0;
  for (const key of PRICE_KEYS) {
    const coin = coins[coinId(key)];
    const price = Number(coin?.price);
    const timestamp = Number(coin?.timestamp);
    const confidence = Number(coin?.confidence);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (!Number.isFinite(timestamp) || timestamp <= 0 || nowSeconds - timestamp > MAX_PRICE_AGE_SECONDS || timestamp - nowSeconds > 120) continue;
    if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE || confidence > 1) continue;
    prices[key] = price;
    newestTimestamp = Math.max(newestTimestamp, timestamp);
  }

  // The market bar and the USD safety context are useful only when the two
  // primary markets and the protocol unit are independently available.
  if (!prices.ETH || !prices.WBTC || !prices.fxUSD) {
    throw new Error('Price response is missing required markets');
  }
  return { prices, updatedAt: newestTimestamp ? newestTimestamp * 1000 : null };
}

export async function fetchUsdPrices(
  request: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<{ prices: UsdPriceMap; updatedAt: number | null }> {
  const response = await request(USD_PRICE_ENDPOINT, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(`Price service returned ${response.status}`);
  return parseUsdPriceResponse(await response.json());
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
