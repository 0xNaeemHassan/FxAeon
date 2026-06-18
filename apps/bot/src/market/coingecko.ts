/**
 * CoinGecko market data — the single data source for /price.
 *
 * Design notes
 * - ONE request fetches every supported asset (`/coins/markets?ids=…`) to
 *   stay far below the demo-tier rate limit (30 calls/min).
 * - Responses are cached in-process for CACHE_TTL_MS; on upstream failure we
 *   fail soft by serving a stale snapshot (≤ STALE_MAX_AGE_MS) marked as such.
 * - A missing/unknown token never fails the whole command: its fields render
 *   as N/A (the row's `data` is null).
 * - To add an asset: append one entry to SUPPORTED_ASSETS. Resolve the id via
 *   https://api.coingecko.com/api/v3/search?query=… — never guess symbols
 *   (e.g. FLUID is `instadapp`, FXN is `fxn-token`).
 */
/** Symbol → CoinGecko id, in the exact display order for /price. */
export const SUPPORTED_ASSETS: ReadonlyArray<{ symbol: string; id: string }> = [
  { symbol: "BTC", id: "bitcoin" },
  { symbol: "ETH", id: "ethereum" },
  { symbol: "FXN", id: "fxn-token" },
  // fxUSD is the protocol's own stablecoin; keep it directly under FXN.
  { symbol: "FXUSD", id: "f-x-protocol-fxusd" },
  // FRAX = Frax governance token (formerly FXS), NOT the legacy stablecoin.
  // The legacy stablecoin is now Frax USD (frxUSD, id: frax-usd).
  { symbol: "FRAX", id: "frax-share" },
  { symbol: "CRV", id: "curve-dao-token" },
  { symbol: "CVX", id: "convex-finance" },
  { symbol: "AAVE", id: "aave" },
  { symbol: "MORPHO", id: "morpho" },
  { symbol: "SDT", id: "stake-dao" },
  { symbol: "LDO", id: "lido-dao" },
  { symbol: "PENDLE", id: "pendle" },
  { symbol: "FLUID", id: "instadapp" },
  { symbol: "ETHFI", id: "ether-fi" },
];

/**
 * Non-display assets fetched in the SAME single request so other features
 * (portfolio USD estimates) get live prices without extra API calls.
 * Not shown by /price.
 */
export const EXTRA_ASSETS: ReadonlyArray<{ symbol: string; id: string }> = [
  { symbol: "wstETH", id: "wrapped-steth" },
  { symbol: "WBTC", id: "wrapped-bitcoin" },
];

export interface AssetMarketData {
  priceUsd: number;
  marketCapUsd: number | null;
  change24hPct: number | null;
  change7dPct: number | null;
}

export interface MarketRow {
  symbol: string;
  /** null ⇒ CoinGecko returned nothing for this asset → render N/A. */
  data: AssetMarketData | null;
}

export interface MarketOverview {
  rows: MarketRow[];
  /** When the underlying snapshot was fetched. */
  fetchedAt: Date;
  /** True when upstream failed and this is a stale cached snapshot. */
  stale: boolean;
}

const BASE_URL = "https://api.coingecko.com/api/v3";
const REQUEST_TIMEOUT_MS = 10_000;
/** Serve from cache for 45s (spec: 30–60s). */
const CACHE_TTL_MS = 45_000;
/** On upstream failure, a snapshot this old may still be served (marked stale). */
const STALE_MAX_AGE_MS = 10 * 60_000;

interface CacheEntry {
  rows: MarketRow[];
  /** Symbol → spot price USD for SUPPORTED_ASSETS ∪ EXTRA_ASSETS (null = unknown). */
  spot: Record<string, number | null>;
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
/** De-duplicates concurrent /price calls into one upstream request. */
let inflight: Promise<CacheEntry> | null = null;

/** Test hook. */
export function clearMarketCache(): void {
  cache = null;
  inflight = null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function fetchFromCoinGecko(): Promise<CacheEntry> {
  const allAssets = [...SUPPORTED_ASSETS, ...EXTRA_ASSETS];
  const ids = allAssets.map((a) => a.id).join(",");
  const url =
    `${BASE_URL}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids)}` +
    `&price_change_percentage=24h,7d&per_page=${allAssets.length}`;

  const headers: Record<string, string> = { accept: "application/json" };
  // Read from process.env directly (not getConfig) so this module never
  // trips the full-config fail-fast in tests; the key is optional anyway.
  const apiKey = process.env.COINGECKO_API_KEY;
  if (apiKey) headers["x-cg-demo-api-key"] = apiKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    const body: unknown = await res.json();
    if (!Array.isArray(body)) throw new Error("CoinGecko: unexpected response shape");

    const byId = new Map<string, Record<string, unknown>>();
    for (const item of body) {
      if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
        byId.set((item as { id: string }).id, item as Record<string, unknown>);
      }
    }

    const rows: MarketRow[] = SUPPORTED_ASSETS.map(({ symbol, id }) => {
      const c = byId.get(id);
      const price = c ? num(c.current_price) : null;
      if (!c || price === null) return { symbol, data: null };
      return {
        symbol,
        data: {
          priceUsd: price,
          marketCapUsd: num(c.market_cap),
          change24hPct:
            num(c.price_change_percentage_24h_in_currency) ??
            num(c.price_change_percentage_24h),
          change7dPct: num(c.price_change_percentage_7d_in_currency),
        },
      };
    });

    const spot: Record<string, number | null> = {};
    for (const { symbol, id } of allAssets) {
      const c = byId.get(id);
      spot[symbol] = c ? num(c.current_price) : null;
    }

    return { rows, spot, fetchedAt: Date.now() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Market overview for every supported asset, in SUPPORTED_ASSETS order.
 * Throws only when there is no fresh data AND no usable stale snapshot.
 */
export async function getMarketOverview(): Promise<MarketOverview> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return { rows: cache.rows, fetchedAt: new Date(cache.fetchedAt), stale: false };
  }

  if (!inflight) {
    inflight = fetchFromCoinGecko().finally(() => {
      inflight = null;
    });
  }

  try {
    cache = await inflight;
    return { rows: cache.rows, fetchedAt: new Date(cache.fetchedAt), stale: false };
  } catch (err) {
    if (cache && now - cache.fetchedAt < STALE_MAX_AGE_MS) {
      return { rows: cache.rows, fetchedAt: new Date(cache.fetchedAt), stale: true };
    }
    throw err;
  }
}

export interface SpotPrices {
  /** Symbol → spot USD price; null when CoinGecko omitted the asset. */
  prices: Record<string, number | null>;
  fetchedAt: Date;
  stale: boolean;
}

/**
 * Spot USD prices for SUPPORTED_ASSETS ∪ EXTRA_ASSETS from the same cached
 * snapshot /price uses — never costs an extra upstream request beyond the
 * shared one. Same failure ladder as getMarketOverview.
 */
export async function getSpotPrices(): Promise<SpotPrices> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return { prices: cache.spot, fetchedAt: new Date(cache.fetchedAt), stale: false };
  }
  if (!inflight) {
    inflight = fetchFromCoinGecko().finally(() => {
      inflight = null;
    });
  }
  try {
    cache = await inflight;
    return { prices: cache.spot, fetchedAt: new Date(cache.fetchedAt), stale: false };
  } catch (err) {
    if (cache && now - cache.fetchedAt < STALE_MAX_AGE_MS) {
      return { prices: cache.spot, fetchedAt: new Date(cache.fetchedAt), stale: true };
    }
    throw err;
  }
}
