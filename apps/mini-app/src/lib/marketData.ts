export type MarketSymbol = 'ETH' | 'BTC';
export type MarketRange = '1D' | '7D' | '30D';

export type MarketHistoryPoint = {
  timestamp: number;
  price: number;
};

export type MarketHistorySnapshot = {
  market: MarketSymbol;
  range: MarketRange;
  points: MarketHistoryPoint[];
  currentPrice: number;
  percentChange: number;
  updatedAt: number;
};

const COINGECKO_API_ROOT = 'https://api.coingecko.com/api/v3';
const COINGECKO_IDS: Record<MarketSymbol, string> = {
  ETH: 'ethereum',
  BTC: 'bitcoin',
};
const RANGE_DAYS: Record<MarketRange, number> = {
  '1D': 1,
  '7D': 7,
  '30D': 30,
};
const MAX_LAST_POINT_AGE_MS: Record<MarketRange, number> = {
  '1D': 60 * 60 * 1000,
  '7D': 6 * 60 * 60 * 1000,
  '30D': 12 * 60 * 60 * 1000,
};
const MAX_POINTS = 96;

export function marketHistoryEndpoint(market: MarketSymbol, range: MarketRange): string {
  return `${COINGECKO_API_ROOT}/coins/${COINGECKO_IDS[market]}/market_chart?vs_currency=usd&days=${RANGE_DAYS[range]}&precision=full`;
}

function downsample(points: readonly MarketHistoryPoint[], maximum = MAX_POINTS): MarketHistoryPoint[] {
  if (points.length <= maximum) return [...points];
  const lastIndex = points.length - 1;
  const sampled: MarketHistoryPoint[] = [];
  for (let index = 0; index < maximum; index += 1) {
    const sourceIndex = Math.round((index * lastIndex) / (maximum - 1));
    const point = points[sourceIndex];
    if (point && point.timestamp !== sampled.at(-1)?.timestamp) sampled.push(point);
  }
  const last = points[lastIndex];
  if (last && sampled.at(-1)?.timestamp !== last.timestamp) sampled.push(last);
  return sampled;
}

export function parseMarketHistoryResponse(
  payload: unknown,
  market: MarketSymbol,
  range: MarketRange,
  nowMs = Date.now(),
): MarketHistorySnapshot {
  if (!payload || typeof payload !== 'object') throw new Error('Market history response is not an object');
  const raw = (payload as { prices?: unknown }).prices;
  if (!Array.isArray(raw)) throw new Error('Market history response has no prices');

  const byTimestamp = new Map<number, MarketHistoryPoint>();
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const timestamp = Number(item[0]);
    const price = Number(item[1]);
    if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > nowMs + 2 * 60 * 1000) continue;
    if (!Number.isFinite(price) || price <= 0) continue;
    byTimestamp.set(timestamp, { timestamp, price });
  }

  const ordered = [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
  if (ordered.length < 6) throw new Error('Market history response has too few valid prices');
  const first = ordered[0];
  const last = ordered.at(-1);
  if (!first || !last) throw new Error('Market history response is empty');
  if (nowMs - last.timestamp > MAX_LAST_POINT_AGE_MS[range]) throw new Error('Market history response is stale');

  const percentChange = ((last.price - first.price) / first.price) * 100;
  if (!Number.isFinite(percentChange)) throw new Error('Market history response has an invalid change');

  return {
    market,
    range,
    points: downsample(ordered),
    currentPrice: last.price,
    percentChange,
    updatedAt: last.timestamp,
  };
}

export async function fetchMarketHistory(
  market: MarketSymbol,
  range: MarketRange,
  request: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<MarketHistorySnapshot> {
  const response = await request(marketHistoryEndpoint(market, range), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(`Market history service returned ${response.status}`);
  return parseMarketHistoryResponse(await response.json(), market, range);
}
