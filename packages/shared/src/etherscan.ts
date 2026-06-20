/**
 * Etherscan API client — live gas oracle, ETH price, and gas estimation.
 *
 * Design:
 * - Single-flight: concurrent calls to the same endpoint share ONE upstream
 *   request, preventing rate-limit waste.
 * - Time-based cache: responses are served from cache within CACHE_TTL_MS.
 *   On upstream failure, a stale snapshot ≤ STALE_MAX_AGE_MS is returned
 *   (marked `stale: true`) so the bot degrades gracefully.
 * - Typed, validated: upstream JSON is parsed and type-checked before caching.
 * - Never fabricates: if the API returns garbage or is unreachable and no
 *   cache exists, the call throws — callers decide how to display the error.
 *
 * Endpoints used (all free-tier):
 * - gastracker/gasoracle → slow/standard/fast gas prices + base fee + block
 * - stats/ethprice       → ETH/USD + ETH/BTC spot price
 * - gastracker/gasestimate → estimated seconds for a given gas price
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface EtherscanGasOracle {
  /** Latest block number (string from API, parsed to number). */
  lastBlock: number;
  /** Safe (slow) gas price in gwei. */
  safeGasPrice: number;
  /** Proposed (standard) gas price in gwei. */
  proposeGasPrice: number;
  /** Fast gas price in gwei. */
  fastGasPrice: number;
  /** Suggested base fee in gwei. */
  suggestBaseFee: number;
  /** Per-block gas used ratios (last 5 blocks). */
  gasUsedRatio: number[];
}

export interface EtherscanEthPrice {
  /** ETH price in USD. */
  ethUsd: number;
  /** ETH price in BTC. */
  ethBtc: number;
  /** Timestamp of ETH/USD price (unix seconds). */
  ethUsdTimestamp: number;
  /** Timestamp of ETH/BTC price (unix seconds). */
  ethBtcTimestamp: number;
}

export interface EtherscanGasEstimate {
  /** Estimated confirmation time in seconds for a given gas price. */
  estimatedSeconds: number;
}

export interface GasOracleSnapshot {
  oracle: EtherscanGasOracle;
  ethPrice: EtherscanEthPrice | null;
  fetchedAt: Date;
  stale: boolean;
}

// ── Configuration ──────────────────────────────────────────────────────────

const BASE_URL = "https://api.etherscan.io/v2/api";
const CHAIN_ID = "1"; // Ethereum Mainnet
const REQUEST_TIMEOUT_MS = 8_000;
/** Serve from cache for 12s (Etherscan free tier allows 5 calls/s). */
const CACHE_TTL_MS = 12_000;
/** On upstream failure, a snapshot this old may still be served (marked stale). */
const STALE_MAX_AGE_MS = 5 * 60_000;

// ── Cache ──────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

let gasOracleCache: CacheEntry<EtherscanGasOracle> | null = null;
let ethPriceCache: CacheEntry<EtherscanEthPrice> | null = null;
let gasOracleInflight: Promise<CacheEntry<EtherscanGasOracle>> | null = null;
let ethPriceInflight: Promise<CacheEntry<EtherscanEthPrice>> | null = null;

/** Test hook — clear all caches. */
export function clearEtherscanCache(): void {
  gasOracleCache = null;
  ethPriceCache = null;
  gasOracleInflight = null;
  ethPriceInflight = null;
}

// ── Fetch helper ───────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.ETHERSCAN_API_KEY;
  if (!key) throw new Error("ETHERSCAN_API_KEY is not set");
  return key;
}

async function etherscanFetch<T>(
  params: Record<string, string>,
  validate: (raw: unknown) => T
): Promise<T> {
  const apiKey = getApiKey();
  const url = new URL(BASE_URL);
  url.searchParams.set("chainid", CHAIN_ID);
  url.searchParams.set("apikey", apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { "User-Agent": "FxAeon/1.0" },
    });
    if (!response.ok) {
      throw new Error(`Etherscan API returned HTTP ${response.status}`);
    }
    const json = (await response.json()) as { status: string; message: string; result: unknown };
    if (json.status !== "1" || json.message !== "OK") {
      throw new Error(`Etherscan API error: ${json.message} (status=${json.status})`);
    }
    return validate(json.result);
  } finally {
    clearTimeout(timeout);
  }
}

// ── Validators ─────────────────────────────────────────────────────────────

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function requireNum(v: unknown, field: string): number {
  const n = num(v);
  if (n === null) throw new Error(`Etherscan: ${field} is not a valid number`);
  return n;
}

function validateGasOracle(raw: unknown): EtherscanGasOracle {
  const r = raw as Record<string, unknown>;
  const ratioStr = typeof r.gasUsedRatio === "string" ? r.gasUsedRatio : "";
  const ratios = ratioStr
    .split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((n) => Number.isFinite(n));

  return {
    lastBlock: requireNum(r.LastBlock, "LastBlock"),
    safeGasPrice: requireNum(r.SafeGasPrice, "SafeGasPrice"),
    proposeGasPrice: requireNum(r.ProposeGasPrice, "ProposeGasPrice"),
    fastGasPrice: requireNum(r.FastGasPrice, "FastGasPrice"),
    suggestBaseFee: requireNum(r.suggestBaseFee, "suggestBaseFee"),
    gasUsedRatio: ratios,
  };
}

function validateEthPrice(raw: unknown): EtherscanEthPrice {
  const r = raw as Record<string, unknown>;
  return {
    ethUsd: requireNum(r.ethusd, "ethusd"),
    ethBtc: requireNum(r.ethbtc, "ethbtc"),
    ethUsdTimestamp: requireNum(r.ethusd_timestamp, "ethusd_timestamp"),
    ethBtcTimestamp: requireNum(r.ethbtc_timestamp, "ethbtc_timestamp"),
  };
}

function validateGasEstimate(raw: unknown): EtherscanGasEstimate {
  const seconds = requireNum(raw, "gasestimate result");
  return { estimatedSeconds: seconds };
}

// ── Single-flight cached fetchers ──────────────────────────────────────────

async function fetchGasOracleUpstream(): Promise<CacheEntry<EtherscanGasOracle>> {
  const data = await etherscanFetch(
    { module: "gastracker", action: "gasoracle" },
    validateGasOracle
  );
  const entry: CacheEntry<EtherscanGasOracle> = { data, fetchedAt: Date.now() };
  gasOracleCache = entry;
  return entry;
}

async function fetchEthPriceUpstream(): Promise<CacheEntry<EtherscanEthPrice>> {
  const data = await etherscanFetch(
    { module: "stats", action: "ethprice" },
    validateEthPrice
  );
  const entry: CacheEntry<EtherscanEthPrice> = { data, fetchedAt: Date.now() };
  ethPriceCache = entry;
  return entry;
}

function isFresh(entry: CacheEntry<unknown> | null): entry is CacheEntry<unknown> & { data: unknown } {
  return entry !== null && Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

function isStaleUsable(entry: CacheEntry<unknown> | null): boolean {
  return entry !== null && Date.now() - entry.fetchedAt < STALE_MAX_AGE_MS;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch the current Etherscan Gas Oracle. Cached and single-flighted.
 * Throws on failure when no stale cache is available.
 */
export async function getGasOracle(): Promise<{ data: EtherscanGasOracle; stale: boolean; fetchedAt: Date }> {
  if (isFresh(gasOracleCache)) {
    return { data: gasOracleCache!.data as EtherscanGasOracle, stale: false, fetchedAt: new Date(gasOracleCache!.fetchedAt) };
  }

  if (!gasOracleInflight) {
    gasOracleInflight = fetchGasOracleUpstream().finally(() => {
      gasOracleInflight = null;
    });
  }

  try {
    const entry = await gasOracleInflight;
    return { data: entry.data, stale: false, fetchedAt: new Date(entry.fetchedAt) };
  } catch (err) {
    if (isStaleUsable(gasOracleCache)) {
      return { data: gasOracleCache!.data as EtherscanGasOracle, stale: true, fetchedAt: new Date(gasOracleCache!.fetchedAt) };
    }
    throw err;
  }
}

/**
 * Fetch ETH/USD and ETH/BTC spot prices from Etherscan. Cached and single-flighted.
 */
export async function getEthPrice(): Promise<{ data: EtherscanEthPrice; stale: boolean; fetchedAt: Date }> {
  if (isFresh(ethPriceCache)) {
    return { data: ethPriceCache!.data as EtherscanEthPrice, stale: false, fetchedAt: new Date(ethPriceCache!.fetchedAt) };
  }

  if (!ethPriceInflight) {
    ethPriceInflight = fetchEthPriceUpstream().finally(() => {
      ethPriceInflight = null;
    });
  }

  try {
    const entry = await ethPriceInflight;
    return { data: entry.data, stale: false, fetchedAt: new Date(entry.fetchedAt) };
  } catch (err) {
    if (isStaleUsable(ethPriceCache)) {
      return { data: ethPriceCache!.data as EtherscanEthPrice, stale: true, fetchedAt: new Date(ethPriceCache!.fetchedAt) };
    }
    throw err;
  }
}

/**
 * Estimate confirmation time for a given gas price (in wei).
 * This is NOT cached — it's a point-in-time estimate.
 */
export async function getGasEstimate(gasPriceWei: bigint): Promise<EtherscanGasEstimate> {
  return etherscanFetch(
    { module: "gastracker", action: "gasestimate", gasprice: gasPriceWei.toString() },
    validateGasEstimate
  );
}

/**
 * Convenience: fetch gas oracle + ETH price in parallel.
 * ETH price failure is non-fatal (returns null).
 */
export async function getGasOracleWithPrice(): Promise<GasOracleSnapshot> {
  const [gasResult, priceResult] = await Promise.allSettled([
    getGasOracle(),
    getEthPrice(),
  ]);

  if (gasResult.status === "rejected") throw gasResult.reason;

  const gas = gasResult.value;
  const price = priceResult.status === "fulfilled" ? priceResult.value.data : null;

  return {
    oracle: gas.data,
    ethPrice: price,
    fetchedAt: gas.fetchedAt,
    stale: gas.stale,
  };
}

// ── Formatting helpers (used by /gas command) ──────────────────────────────

/** Format gwei with appropriate precision (sub-1 gets 4 decimals). */
export function formatGweiPrice(gwei: number): string {
  if (gwei >= 10) return gwei.toFixed(1);
  if (gwei >= 1) return gwei.toFixed(2);
  return gwei.toFixed(4);
}

/** Format a gas cost in ETH. */
export function formatEthCost(gwei: number, gasUnits: number): string {
  const costEth = (gwei * gasUnits) / 1e9;
  if (costEth < 0.00001) return costEth.toExponential(2);
  return costEth.toFixed(6);
}

/** Format a gas cost in USD. */
export function formatUsdCost(gwei: number, gasUnits: number, ethUsd: number): string {
  const costUsd = (gwei * gasUnits * ethUsd) / 1e9;
  if (costUsd < 0.01) return `<$0.01`;
  if (costUsd < 1) return `$${costUsd.toFixed(2)}`;
  return `$${costUsd.toFixed(2)}`;
}

/** Average gas-used ratio as a percentage string. */
export function formatGasUsedRatio(ratios: number[]): string {
  if (ratios.length === 0) return "N/A";
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  return `${(avg * 100).toFixed(1)}%`;
}
