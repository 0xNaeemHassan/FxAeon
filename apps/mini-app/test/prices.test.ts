import assert from "node:assert/strict";
import test from "node:test";
import { FX_TOKENS, type FxTokenKey } from "../src/lib/fx/tokens";
import {
  formatUsd,
  coinGeckoTokenPriceEndpoint,
  createUsdPriceFetcher,
  parseCoinGeckoTokenPriceResponse,
  parseUsdPriceCache,
  parseUsdPriceResponse,
  priceKeyForSymbol,
  usdValueForDecimal,
  usdValueForUnits,
} from "../src/lib/prices";

const keys = Object.keys(FX_TOKENS) as FxTokenKey[];

function validPayload(now: number) {
  const coins: Record<string, { price: number; timestamp: number; confidence: number }> = {};
  for (const key of keys) {
    const token = key === "ETH" ? FX_TOKENS.WETH : FX_TOKENS[key];
    const id = `ethereum:${token.address.toLowerCase()}`;
    const price = key === "WBTC" ? 104_000 : key === "ETH" || key === "WETH" ? 2_400 : 1;
    coins[id] = { price, timestamp: now - 12, confidence: 0.99 };
  }
  return { coins };
}

test("accepts recent, confident prices and maps ETH to WETH", () => {
  const now = 2_000_000_000;
  const snapshot = parseUsdPriceResponse(validPayload(now), now);
  assert.equal(snapshot.prices.ETH, 2_400);
  assert.equal(snapshot.prices.WETH, 2_400);
  assert.equal(snapshot.prices.WBTC, 104_000);
  assert.equal(snapshot.prices.fxUSD, 1);
  assert.equal(snapshot.updatedAt, (now - 12) * 1_000);
});

test("rejects stale and low-confidence prices without discarding independently valid tokens", () => {
  const now = 2_000_000_000;
  const stale = validPayload(now);
  for (const coin of Object.values(stale.coins)) coin.timestamp = now - 901;
  assert.throws(() => parseUsdPriceResponse(stale, now), /no validated prices/);

  const lowConfidence = validPayload(now);
  for (const coin of Object.values(lowConfidence.coins)) coin.confidence = 0.49;
  assert.throws(() => parseUsdPriceResponse(lowConfidence, now), /no validated prices/);

  const incomplete = validPayload(now);
  delete incomplete.coins[`ethereum:${FX_TOKENS.WBTC.address.toLowerCase()}`];
  incomplete.coins[`ethereum:${FX_TOKENS.fxUSD.address.toLowerCase()}`].timestamp = now - 901;
  const partial = parseUsdPriceResponse(incomplete, now);
  assert.equal(partial.prices.ETH, 2_400);
  assert.equal(partial.prices.WBTC, undefined);
  assert.equal(partial.prices.fxUSD, undefined);
});

test("calculates display-only USD values without changing token units", () => {
  assert.equal(priceKeyForSymbol("BTC"), "WBTC");
  assert.equal(priceKeyForSymbol("fxSP"), "fxUSDBasePool");
  assert.equal(usdValueForDecimal("2.5", 2_400), 6_000);
  assert.equal(usdValueForUnits(2_500_000n, 6, 1), 2.5);
  assert.equal(usdValueForDecimal("all", 1), null);
  assert.equal(formatUsd(6_000), "$6,000.00");
  assert.equal(formatUsd(0.001), "<$0.01");
});

test("restores only a recent, validated USD snapshot", () => {
  const now = 2_000_000_000_000;
  const prices = parseUsdPriceResponse(validPayload(Math.floor(now / 1_000)), Math.floor(now / 1_000)).prices;
  assert.deepEqual(parseUsdPriceCache({ prices, updatedAt: now - 12_000 }, now), {
    prices,
    updatedAt: now - 12_000,
  });
  assert.equal(parseUsdPriceCache({ prices, updatedAt: now - 121_000 }, now), null);
  assert.equal(parseUsdPriceCache({ prices: { ...prices, fxUSD: 0 }, updatedAt: now - 12_000 }, now)?.prices.fxUSD, undefined);
  assert.equal(parseUsdPriceCache({ prices: { fxUSD: 0 }, updatedAt: now - 12_000 }, now), null);
});

test("CoinGecko fallback validates the exact contract, numeric price, and timestamp", () => {
  const now = 2_000_000_000;
  const address = FX_TOKENS.fxUSD.address.toLowerCase();
  assert.deepEqual(parseCoinGeckoTokenPriceResponse({ [address]: { usd: 0.997, last_updated_at: now - 20 } }, 'fxUSD', now), { price: 0.997, timestamp: now - 20 });
  for (const entry of [
    { usd: 1, last_updated_at: now - 901 },
    { usd: 1, last_updated_at: now + 121 },
    { usd: 1 }, { usd: 0, last_updated_at: now },
    { usd: Infinity, last_updated_at: now }, { usd: '1', last_updated_at: now },
  ]) assert.equal(parseCoinGeckoTokenPriceResponse({ [address]: entry }, 'fxUSD', now), null);
  assert.equal(parseCoinGeckoTokenPriceResponse({ unrelated: { usd: 1, last_updated_at: now } }, 'fxUSD', now), null);
  assert.equal(new URL(coinGeckoTokenPriceEndpoint('fxUSD')).searchParams.get('contract_addresses'), address);
  assert.equal(new URL(coinGeckoTokenPriceEndpoint('ETH')).searchParams.get('contract_addresses'), FX_TOKENS.WETH.address.toLowerCase());
});

test("a delayed protocol price uses a fresh CoinGecko quote without replacing fresh primary tokens", async () => {
  const now = Math.floor(Date.now() / 1000);
  const payload = validPayload(now);
  const address = FX_TOKENS.fxUSD.address.toLowerCase();
  payload.coins[`ethereum:${address}`].timestamp = now - 901;
  const calls: string[] = [];
  const request = (async (input) => {
    const url = String(input); calls.push(url);
    return Response.json(url.includes('coins.llama.fi') ? payload : { [address]: { usd: 0.998, last_updated_at: now - 3 } });
  }) as typeof fetch;
  const fetchPrices = createUsdPriceFetcher();
  const first = await fetchPrices(request);
  assert.equal(first.prices.fxUSD, 0.998);
  assert.equal(first.prices.ETH, 2_400);
  assert.equal(first.updatedAt, (now - 12) * 1000, 'freshness uses the oldest included price');
  const second = await fetchPrices(request);
  assert.equal(second.prices.fxUSD, 0.998);
  assert.equal(calls.filter(url => url.includes('api.coingecko.com')).length, 1, 'fallback cached for one minute');
});

test("unavailable fallback prices stay absent instead of assuming the stablecoin peg", async () => {
  const payload = validPayload(Math.floor(Date.now() / 1000));
  delete payload.coins[`ethereum:${FX_TOKENS.fxUSD.address.toLowerCase()}`];
  const request = (async input => String(input).includes('coins.llama.fi') ? Response.json(payload) : Response.json({})) as typeof fetch;
  const result = await createUsdPriceFetcher()(request);
  assert.equal(result.prices.ETH, 2_400);
  assert.equal(result.prices.fxUSD, undefined);
});

test("fallback traffic is bounded and respects rate-limit backoff", async () => {
  let fallbackRequests = 0;
  const request = (async input => {
    if (String(input).includes('coins.llama.fi')) return Response.json({}, { status: 503 });
    fallbackRequests += 1;
    return Response.json({}, { status: 429, headers: { 'retry-after': '300' } });
  }) as typeof fetch;
  const fetchPrices = createUsdPriceFetcher();
  await assert.rejects(fetchPrices(request), /no validated prices/);
  await assert.rejects(fetchPrices(request), /no validated prices/);
  assert.equal(fallbackRequests, 1);

  let boundedRequests = 0;
  const failing = (async input => {
    if (String(input).includes('api.coingecko.com')) boundedRequests += 1;
    return Response.json({}, { status: 503 });
  }) as typeof fetch;
  await assert.rejects(createUsdPriceFetcher()(failing), /no validated prices/);
  assert.equal(boundedRequests, 3);
});

test("aborting a price refresh does not request fallback data", async () => {
  const controller = new AbortController();
  let calls = 0;
  const request = (async () => { calls += 1; controller.abort(); throw new Error('aborted'); }) as typeof fetch;
  await assert.rejects(createUsdPriceFetcher()(request, controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});
