import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCoinbaseTickerController,
  fetchMarketCandles,
  liveMarketReconnectDelay,
  liveQuoteCandle,
  parseCoinbaseCandlesResponse,
  parseCoinbaseTickerMessage,
  type MarketWebSocket,
} from '../src/lib/liveMarket';

const NOW = Date.parse('2026-09-05T12:00:00.000Z');

function ticker(overrides: Record<string, unknown> = {}) {
  return {
    type: 'ticker',
    product_id: 'ETH-USD',
    price: '2401.00',
    open_24h: '2350.00',
    high_24h: '2410.00',
    low_24h: '2330.00',
    sequence: 10,
    time: '2026-09-05T11:59:59.000Z',
    ...overrides,
  };
}

test('accepts an anchored, current Coinbase tick and rejects malformed or divergent ticks', () => {
  const quote = parseCoinbaseTickerMessage(ticker(), { ETH: 2400 }, {}, NOW);
  assert.equal(quote?.market, 'ETH');
  assert.equal(quote?.price, 2401);
  assert.equal(quote?.percentChange24h, ((2401 - 2350) / 2350) * 100);

  assert.equal(parseCoinbaseTickerMessage(ticker({ price: 0 }), { ETH: 2400 }, {}, NOW), null);
  assert.equal(parseCoinbaseTickerMessage(ticker({ time: '2026-09-05T11:57:00.000Z' }), { ETH: 2400 }, {}, NOW), null);
  assert.equal(parseCoinbaseTickerMessage(ticker({ price: 3000 }), { ETH: 2400 }, {}, NOW), null);
  assert.equal(parseCoinbaseTickerMessage(ticker({ sequence: 10 }), { ETH: 2400 }, { ETH: 10 }, NOW), null);
  assert.equal(parseCoinbaseTickerMessage(ticker({ product_id: 'SOL-USD' }), { ETH: 2400 }, {}, NOW), null);
});

test('keeps candle data ordered, deduplicated, and within the selected range', () => {
  const payload = [
    [NOW / 1000 - 60, 2_398, 2_402, 2_399, 2_401],
    [NOW / 1000 - 120, 2_395, 2_400, 2_396, 2_399],
    [NOW / 1000 - 60, 2_398, 2_403, 2_399, 2_402],
    [NOW / 1000 + 60, 2_400, 2_405, 2_401, 2_404],
    ['bad', 1, 2, 1, 2],
  ];
  const snapshot = parseCoinbaseCandlesResponse(payload, 'ETH', '1H', NOW);
  assert.deepEqual(snapshot.candles.map((candle) => candle.time), [NOW / 1000 - 120, NOW / 1000 - 60]);
  assert.equal(snapshot.candles.at(-1)?.high, 2403);
  assert.equal(snapshot.currentPrice, 2402);
  assert.equal(snapshot.points.at(-1)?.price, 2402);
});

test('updates only the active OHLC bucket for a fresh live quote', () => {
  const history = {
    market: 'ETH' as const,
    range: '1H' as const,
    candles: [{ time: NOW / 1000 - 60, open: 2390, high: 2400, low: 2385, close: 2395 }],
    points: [{ timestamp: NOW - 60_000, price: 2395 }],
    currentPrice: 2395,
    percentChange: 0,
    high: 2400,
    low: 2385,
    updatedAt: NOW - 60_000,
    source: 'coinbase' as const,
  };
  const quote = parseCoinbaseTickerMessage(ticker({ price: 2403, sequence: 11 }), { ETH: 2400 }, {}, NOW)!;
  const candle = liveQuoteCandle(history, quote);
  assert.equal(candle?.time, NOW / 1000 - 60);
  assert.equal(candle?.open, 2390);
  assert.equal(candle?.high, 2403);
  assert.equal(candle?.close, 2403);
});

test('Coinbase candle failures fall back to validated CoinGecko history', async () => {
  const now = Date.now();
  const request = (async (input) => {
    const url = String(input);
    if (url.includes('exchange.coinbase.com')) return Response.json({}, { status: 503 });
    return Response.json({ prices: Array.from({ length: 96 }, (_, index) => [now - (95 - index) * 5 * 60_000, 2_300 + index]) });
  }) as typeof fetch;
  const snapshot = await fetchMarketCandles('BTC', '1H', request);
  assert.equal(snapshot.source, 'coingecko');
  assert.ok(snapshot.candles.length >= 6);
  assert.equal(snapshot.market, 'BTC');
});

test('reconnect delay is bounded and the controller tears down when paused', () => {
  assert.ok(liveMarketReconnectDelay(0, () => 0) >= 640);
  assert.ok(liveMarketReconnectDelay(100, () => 1) <= 36_000);

  const sockets: FakeSocket[] = [];
  const statuses: string[] = [];
  const scheduled: Array<() => void> = [];
  const controller = createCoinbaseTickerController({
    onQuote: () => undefined,
    onStatus: (status) => statuses.push(status),
    getAnchors: () => ({ ETH: 2400 }),
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    schedule: (callback, _delayMs) => { scheduled.push(callback); return {} as ReturnType<typeof setTimeout>; },
    cancelSchedule: () => undefined,
    random: () => 0.5,
  });
  controller.setActive(true);
  assert.equal(sockets.length, 1);
  sockets[0]!.onopen?.();
  assert.equal(statuses.at(-1), 'live');
  sockets[0]!.onclose?.();
  assert.equal(statuses.at(-1), 'reconnecting');
  controller.setActive(false);
  assert.equal(statuses.at(-1), 'paused');
  scheduled[0]?.();
  assert.equal(sockets.length, 1, 'paused controller must not reconnect');
  controller.stop();
});

class FakeSocket implements MarketWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data?: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send(): void { /* no-op */ }
  close(): void { /* no-op */ }
}
