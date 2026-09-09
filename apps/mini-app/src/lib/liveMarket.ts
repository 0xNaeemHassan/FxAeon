import {
  fetchMarketHistory,
  type MarketHistorySnapshot,
  type MarketSymbol,
} from '@/lib/marketData';

export type LiveMarketStatus = 'paused' | 'connecting' | 'live' | 'reconnecting' | 'unavailable';
export type LiveMarketRange = '1H' | '1D' | '7D' | '30D';

export type LiveQuote = {
  market: MarketSymbol;
  productId: 'ETH-USD' | 'BTC-USD';
  price: number;
  open24h: number;
  high24h: number;
  low24h: number;
  percentChange24h: number;
  sequence: number;
  sourceAt: number;
  receivedAt: number;
  source: 'coinbase';
};

export type MarketCandle = {
  /** Unix seconds, as required by lightweight-charts. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type MarketCandleSnapshot = {
  market: MarketSymbol;
  range: LiveMarketRange;
  candles: MarketCandle[];
  /** Compatibility projection for lightweight instrument summaries. */
  points: Array<{ timestamp: number; price: number }>;
  currentPrice: number;
  percentChange: number;
  high: number;
  low: number;
  updatedAt: number;
  source: 'coinbase' | 'coingecko';
};

export type LivePriceAnchors = Partial<Record<MarketSymbol, number>>;

export const COINBASE_MARKET_WEBSOCKET_URL = 'wss://ws-feed.exchange.coinbase.com';
export const COINBASE_MARKET_API_ROOT = 'https://api.exchange.coinbase.com';
export const LIVE_QUOTE_MAX_AGE_MS = 20_000;
export const LIVE_ANCHOR_MAX_DEVIATION = 0.15;

const PRODUCT_MARKETS = {
  'ETH-USD': 'ETH',
  'BTC-USD': 'BTC',
} as const satisfies Record<string, MarketSymbol>;

const RANGE_DURATION_MS: Record<LiveMarketRange, number> = {
  '1H': 60 * 60 * 1_000,
  '1D': 24 * 60 * 60 * 1_000,
  '7D': 7 * 24 * 60 * 60 * 1_000,
  '30D': 30 * 24 * 60 * 60 * 1_000,
};

const RANGE_GRANULARITY_SECONDS: Record<LiveMarketRange, 60 | 300 | 3600 | 21600> = {
  '1H': 60,
  '1D': 300,
  '7D': 3600,
  '30D': 21600,
};

const MAX_FUTURE_SKEW_MS = 10_000;
const MAX_TICK_SOURCE_AGE_MS = 60_000;
const BASE_RECONNECT_MS = 800;
const MAX_RECONNECT_MS = 30_000;

function positiveFinite(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Treat the public feed as an untrusted display source. A tick is accepted only
 * when its identity, ordering, timestamp, numeric fields, and independently
 * validated HTTP anchor all agree.
 */
export function parseCoinbaseTickerMessage(
  payload: unknown,
  anchors: LivePriceAnchors,
  lastSequences: Partial<Record<MarketSymbol, number>> = {},
  nowMs = Date.now(),
): LiveQuote | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as Record<string, unknown>;
  if (candidate.type !== 'ticker') return null;
  if (candidate.product_id !== 'ETH-USD' && candidate.product_id !== 'BTC-USD') return null;

  const productId = candidate.product_id;
  const market = PRODUCT_MARKETS[productId];
  const price = positiveFinite(candidate.price);
  const open24h = positiveFinite(candidate.open_24h);
  const high24h = positiveFinite(candidate.high_24h);
  const low24h = positiveFinite(candidate.low_24h);
  const anchor = positiveFinite(anchors[market]);
  const sequence = Number(candidate.sequence);
  const sourceAt = typeof candidate.time === 'string' ? Date.parse(candidate.time) : Number.NaN;

  if (price === null || open24h === null || high24h === null || low24h === null || anchor === null) return null;
  if (!Number.isSafeInteger(sequence) || sequence <= 0 || sequence <= (lastSequences[market] ?? -1)) return null;
  if (!Number.isFinite(sourceAt) || sourceAt <= 0) return null;
  if (nowMs - sourceAt > MAX_TICK_SOURCE_AGE_MS || sourceAt - nowMs > MAX_FUTURE_SKEW_MS) return null;
  if (low24h > high24h || high24h < Math.max(open24h, price) || low24h > Math.min(open24h, price)) return null;
  if (Math.abs(price - anchor) / anchor > LIVE_ANCHOR_MAX_DEVIATION) return null;

  const percentChange24h = ((price - open24h) / open24h) * 100;
  if (!Number.isFinite(percentChange24h)) return null;

  return {
    market,
    productId,
    price,
    open24h,
    high24h,
    low24h,
    percentChange24h,
    sequence,
    sourceAt,
    receivedAt: nowMs,
    source: 'coinbase',
  };
}

export function isLiveQuoteFresh(quote: LiveQuote | null | undefined, nowMs = Date.now()): quote is LiveQuote {
  return Boolean(
    quote
      && quote.receivedAt <= nowMs + MAX_FUTURE_SKEW_MS
      && nowMs - quote.receivedAt <= LIVE_QUOTE_MAX_AGE_MS,
  );
}

/** Exponential reconnect with bounded symmetric jitter. */
export function liveMarketReconnectDelay(attempt: number, random = Math.random): number {
  const exponent = Math.min(Math.max(0, Math.trunc(attempt)), 8);
  const base = Math.min(MAX_RECONNECT_MS, BASE_RECONNECT_MS * (2 ** exponent));
  const jitter = 0.8 + Math.min(1, Math.max(0, random())) * 0.4;
  return Math.round(base * jitter);
}

type SocketEvent = { data?: unknown };

export interface MarketWebSocket {
  onopen: (() => void) | null;
  onmessage: ((event: SocketEvent) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export type CoinbaseTickerController = {
  setActive(active: boolean): void;
  stop(): void;
};

export function createCoinbaseTickerController(options: {
  onQuote: (quote: LiveQuote) => void;
  onStatus: (status: LiveMarketStatus) => void;
  getAnchors: () => LivePriceAnchors;
  createSocket?: (url: string) => MarketWebSocket;
  schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  cancelSchedule?: (handle: TimerHandle) => void;
  random?: () => number;
  now?: () => number;
}): CoinbaseTickerController {
  const createSocket = options.createSocket ?? ((url) => new WebSocket(url) as MarketWebSocket);
  const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancelSchedule = options.cancelSchedule ?? ((handle) => clearTimeout(handle));
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const sequences: Partial<Record<MarketSymbol, number>> = {};
  let socket: MarketWebSocket | null = null;
  let retryTimer: TimerHandle | null = null;
  let retryAttempt = 0;
  let active = false;
  let disposed = false;
  let status: LiveMarketStatus = 'paused';

  const setStatus = (next: LiveMarketStatus) => {
    if (status === next) return;
    status = next;
    options.onStatus(next);
  };

  const clearRetry = () => {
    if (retryTimer === null) return;
    cancelSchedule(retryTimer);
    retryTimer = null;
  };

  const detachAndClose = () => {
    const current = socket;
    socket = null;
    if (!current) return;
    current.onopen = null;
    current.onmessage = null;
    current.onerror = null;
    current.onclose = null;
    try { current.close(1000, 'FxAeon market feed paused'); } catch { /* Already closed. */ }
  };

  const scheduleReconnect = () => {
    if (!active || disposed || retryTimer !== null) return;
    setStatus('reconnecting');
    const delay = liveMarketReconnectDelay(retryAttempt, random);
    retryAttempt += 1;
    retryTimer = schedule(() => {
      retryTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (!active || disposed || socket) return;
    setStatus(retryAttempt > 0 ? 'reconnecting' : 'connecting');
    let current: MarketWebSocket;
    try {
      current = createSocket(COINBASE_MARKET_WEBSOCKET_URL);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = current;

    current.onopen = () => {
      if (socket !== current || !active || disposed) return;
      try {
        current.send(JSON.stringify({
          type: 'subscribe',
          product_ids: ['ETH-USD', 'BTC-USD'],
          channels: ['ticker_batch'],
        }));
        setStatus('live');
      } catch {
        detachAndClose();
        scheduleReconnect();
      }
    };

    current.onmessage = (event) => {
      if (socket !== current || !active || disposed || typeof event.data !== 'string') return;
      let payload: unknown;
      try { payload = JSON.parse(event.data); } catch { return; }
      const quote = parseCoinbaseTickerMessage(payload, options.getAnchors(), sequences, now());
      if (!quote) return;
      sequences[quote.market] = quote.sequence;
      retryAttempt = 0;
      options.onQuote(quote);
    };

    current.onerror = () => {
      if (socket !== current) return;
      detachAndClose();
      scheduleReconnect();
    };

    current.onclose = () => {
      if (socket !== current) return;
      socket = null;
      scheduleReconnect();
    };
  };

  return {
    setActive(nextActive) {
      if (disposed || active === nextActive) return;
      active = nextActive;
      if (!active) {
        clearRetry();
        detachAndClose();
        setStatus('paused');
        return;
      }
      connect();
    },
    stop() {
      if (disposed) return;
      active = false;
      disposed = true;
      clearRetry();
      detachAndClose();
      setStatus('paused');
    },
  };
}

export function coinbaseCandlesEndpoint(
  market: MarketSymbol,
  range: LiveMarketRange,
  nowMs = Date.now(),
): string {
  const product = market === 'ETH' ? 'ETH-USD' : 'BTC-USD';
  const query = new URLSearchParams({
    start: new Date(nowMs - RANGE_DURATION_MS[range]).toISOString(),
    end: new Date(nowMs).toISOString(),
    granularity: String(RANGE_GRANULARITY_SECONDS[range]),
  });
  return `${COINBASE_MARKET_API_ROOT}/products/${product}/candles?${query}`;
}

function candleSnapshot(
  market: MarketSymbol,
  range: LiveMarketRange,
  candles: MarketCandle[],
  source: MarketCandleSnapshot['source'],
): MarketCandleSnapshot {
  const first = candles[0];
  const last = candles.at(-1);
  if (!first || !last || candles.length < 2) throw new Error('Market candle response has too few valid candles');
  const percentChange = ((last.close - first.open) / first.open) * 100;
  if (!Number.isFinite(percentChange)) throw new Error('Market candle response has an invalid change');
  return {
    market,
    range,
    candles,
    points: candles.map((candle) => ({ timestamp: candle.time * 1_000, price: candle.close })),
    currentPrice: last.close,
    percentChange,
    high: Math.max(...candles.map((candle) => candle.high)),
    low: Math.min(...candles.map((candle) => candle.low)),
    updatedAt: last.time * 1_000,
    source,
  };
}

export function parseCoinbaseCandlesResponse(
  payload: unknown,
  market: MarketSymbol,
  range: LiveMarketRange,
  nowMs = Date.now(),
): MarketCandleSnapshot {
  if (!Array.isArray(payload)) throw new Error('Market candle response is not an array');
  const minimumTime = nowMs - RANGE_DURATION_MS[range] - RANGE_GRANULARITY_SECONDS[range] * 2_000;
  const byTime = new Map<number, MarketCandle>();

  for (const row of payload) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const time = Number(row[0]);
    const low = positiveFinite(row[1]);
    const high = positiveFinite(row[2]);
    const open = positiveFinite(row[3]);
    const close = positiveFinite(row[4]);
    const timestampMs = time * 1_000;
    if (!Number.isSafeInteger(time) || time <= 0 || timestampMs < minimumTime || timestampMs > nowMs + MAX_FUTURE_SKEW_MS) continue;
    if (low === null || high === null || open === null || close === null) continue;
    if (low > high || high < Math.max(open, close) || low > Math.min(open, close)) continue;
    byTime.set(time, { time, open, high, low, close });
  }

  const candles = [...byTime.values()].sort((left, right) => left.time - right.time);
  return candleSnapshot(market, range, candles, 'coinbase');
}

export function marketHistoryToCandles(
  history: MarketHistorySnapshot,
  range: LiveMarketRange,
  nowMs = Date.now(),
): MarketCandleSnapshot {
  const granularity = RANGE_GRANULARITY_SECONDS[range];
  const minimumTime = nowMs - RANGE_DURATION_MS[range] - granularity * 1_000;
  const buckets = new Map<number, MarketCandle>();

  for (const point of history.points) {
    if (point.timestamp < minimumTime || point.timestamp > nowMs + MAX_FUTURE_SKEW_MS) continue;
    const time = Math.floor(point.timestamp / 1_000 / granularity) * granularity;
    const existing = buckets.get(time);
    if (!existing) {
      buckets.set(time, { time, open: point.price, high: point.price, low: point.price, close: point.price });
    } else {
      existing.high = Math.max(existing.high, point.price);
      existing.low = Math.min(existing.low, point.price);
      existing.close = point.price;
    }
  }

  const candles = [...buckets.values()].sort((left, right) => left.time - right.time);
  return candleSnapshot(history.market, range, candles, 'coingecko');
}

export async function fetchMarketCandles(
  market: MarketSymbol,
  range: LiveMarketRange,
  request: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<MarketCandleSnapshot> {
  try {
    const candleSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(12_000)]);
    const response = await request(coinbaseCandlesEndpoint(market, range), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: candleSignal,
    });
    if (!response.ok) throw new Error(`Coinbase candle service returned ${response.status}`);
    return parseCoinbaseCandlesResponse(await response.json(), market, range);
  } catch (cause) {
    if (signal?.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) throw cause;
  }

  const fallbackRange = range === '1H' ? '1D' : range;
  const fallbackSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15_000)]);
  const history = await fetchMarketHistory(market, fallbackRange, request, fallbackSignal);
  return marketHistoryToCandles(history, range);
}

/** Build the current OHLC bucket without mutating the fetched snapshot. */
export function liveQuoteCandle(
  snapshot: MarketCandleSnapshot,
  quote: LiveQuote,
): MarketCandle | null {
  if (snapshot.market !== quote.market) return null;
  const granularity = RANGE_GRANULARITY_SECONDS[snapshot.range];
  const time = Math.floor(quote.sourceAt / 1_000 / granularity) * granularity;
  const last = snapshot.candles.at(-1);
  if (!last || time < last.time) return null;
  if (time === last.time) {
    return {
      ...last,
      high: Math.max(last.high, quote.price),
      low: Math.min(last.low, quote.price),
      close: quote.price,
    };
  }
  return { time, open: last.close, high: Math.max(last.close, quote.price), low: Math.min(last.close, quote.price), close: quote.price };
}
