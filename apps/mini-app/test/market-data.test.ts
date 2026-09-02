import assert from "node:assert/strict";
import test from "node:test";
import {
  marketHistoryEndpoint,
  parseMarketHistoryResponse,
} from "../src/lib/marketData";

function validHistory(nowMs: number, count = 120): { prices: Array<[number, number]> } {
  const interval = 5 * 60 * 1_000;
  return {
    prices: Array.from({ length: count }, (_, index) => [
      nowMs - (count - 1 - index) * interval,
      2_300 + index * (100 / (count - 1)),
    ]),
  };
}

test("builds the reviewed CoinGecko market-history endpoints", () => {
  assert.equal(
    marketHistoryEndpoint("ETH", "1D"),
    "https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=1&precision=full",
  );
  assert.equal(
    marketHistoryEndpoint("BTC", "30D"),
    "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=30&precision=full",
  );
});

test("accepts fresh positive history, computes change, and bounds chart density", () => {
  const nowMs = 2_000_000_000_000;
  const snapshot = parseMarketHistoryResponse(validHistory(nowMs), "ETH", "1D", nowMs);

  assert.equal(snapshot.market, "ETH");
  assert.equal(snapshot.range, "1D");
  assert.equal(snapshot.points.length, 96);
  assert.equal(snapshot.points[0]?.price, 2_300);
  assert.equal(snapshot.points.at(-1)?.price, 2_400);
  assert.equal(snapshot.currentPrice, 2_400);
  assert.equal(snapshot.updatedAt, nowMs);
  assert.ok(Math.abs(snapshot.percentChange - ((2_400 - 2_300) / 2_300) * 100) < 1e-9);
});

test("sorts and deduplicates valid points without accepting malformed samples", () => {
  const nowMs = 2_000_000_000_000;
  const payload = validHistory(nowMs, 8);
  payload.prices.reverse();
  payload.prices.push([nowMs, 2_410]);
  payload.prices.push([Number.NaN, 2_400], [nowMs - 1_000, -1]);

  const snapshot = parseMarketHistoryResponse(payload, "BTC", "7D", nowMs);
  assert.equal(snapshot.points.length, 8);
  assert.equal(snapshot.currentPrice, 2_410);
  assert.equal(snapshot.points.at(-1)?.timestamp, nowMs);
});

test("rejects missing, sparse, stale, and future-only market history", () => {
  const nowMs = 2_000_000_000_000;
  assert.throws(() => parseMarketHistoryResponse({}, "ETH", "1D", nowMs), /no prices/);
  assert.throws(
    () => parseMarketHistoryResponse(validHistory(nowMs, 5), "ETH", "1D", nowMs),
    /too few valid prices/,
  );

  const stale = validHistory(nowMs - 61 * 60 * 1_000, 8);
  assert.throws(() => parseMarketHistoryResponse(stale, "ETH", "1D", nowMs), /stale/);

  const future = {
    prices: Array.from({ length: 8 }, (_, index): [number, number] => [
      nowMs + (index + 3) * 60 * 1_000,
      2_400 + index,
    ]),
  };
  assert.throws(() => parseMarketHistoryResponse(future, "ETH", "1D", nowMs), /too few valid prices/);
});
