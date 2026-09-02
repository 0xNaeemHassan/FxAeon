import assert from "node:assert/strict";
import test from "node:test";
import { FX_TOKENS, type FxTokenKey } from "../src/lib/fx/tokens";
import {
  formatUsd,
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

test("rejects stale, low-confidence, and incomplete required markets", () => {
  const now = 2_000_000_000;
  const stale = validPayload(now);
  for (const coin of Object.values(stale.coins)) coin.timestamp = now - 901;
  assert.throws(() => parseUsdPriceResponse(stale, now), /missing required markets/);

  const lowConfidence = validPayload(now);
  for (const coin of Object.values(lowConfidence.coins)) coin.confidence = 0.49;
  assert.throws(() => parseUsdPriceResponse(lowConfidence, now), /missing required markets/);

  const incomplete = validPayload(now);
  delete incomplete.coins[`ethereum:${FX_TOKENS.WBTC.address.toLowerCase()}`];
  assert.throws(() => parseUsdPriceResponse(incomplete, now), /missing required markets/);
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
