import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildGasTierQuotesFromPrices,
  buildRpcGasTierQuotes,
  fetchGasTierQuotes,
  formatGasTierQuote,
  resetGasTierQuoteCacheForTests,
  selectedGasTierQuote,
} from '../src/lib/fx/gasFeePolicy';

test('gas tiers preserve the selected total rate and derive bounded EIP-1559 caps', () => {
  const quotes = buildGasTierQuotesFromPrices(1, 100n, {
    standard: 110n,
    fast: 125n,
    rapid: 150n,
  }, 'rpc', 1_000, 1_000);
  assert.deepEqual(quotes.tiers.standard, {
    tier: 'standard', gasPriceWei: 110n, maxFeePerGas: 210n,
    maxPriorityFeePerGas: 10n, source: 'rpc',
  });
  assert.equal(quotes.tiers.fast.gasPriceWei, 125n);
  assert.equal(quotes.tiers.fast.maxFeePerGas, 225n);
  assert.equal(quotes.tiers.rapid.maxPriorityFeePerGas, 50n);
  assert.equal(formatGasTierQuote(quotes.tiers.fast), 'Fast · <0.001 Gwei');
  assert.equal(quotes.validUntil, 31_000);
  assert.equal(selectedGasTierQuote(quotes, 'fast', 30_999).maxFeePerGas, 225n);
  assert.throws(() => selectedGasTierQuote(quotes, 'fast', 31_000), /expired/);
});

test('RPC tiers use bounded feeHistory percentiles and reject incomplete histories', () => {
  const history = {
    baseFeePerGas: [1, 2, 3, 4, 100, 200].map((value) => `0x${value.toString(16)}`),
    reward: [
      [10, 20, 30],
      [11, 21, 31],
      [12, 22, 32],
      [13, 23, 33],
      [14, 24, 34],
    ].map((row) => row.map((value) => `0x${value.toString(16)}`)),
  };
  const quotes = buildRpcGasTierQuotes(8453, history, 50_000);
  assert.equal(quotes.source, 'rpc');
  assert.equal(quotes.baseFeePerGasWei, 100n);
  assert.deepEqual(
    [quotes.tiers.standard.gasPriceWei, quotes.tiers.fast.gasPriceWei, quotes.tiers.rapid.gasPriceWei],
    [112n, 122n, 132n],
  );
  assert.throws(() => buildRpcGasTierQuotes(8453, { ...history, reward: history.reward.slice(1) }, 50_000), /incomplete/);
});

test('fee policy rejects inverted tiers and malformed selected caps', () => {
  assert.throws(() => buildGasTierQuotesFromPrices(1, 100n, {
    standard: 120n,
    fast: 110n,
    rapid: 130n,
  }, 'rpc', 1_000, 1_000), /tiers are invalid/);
  const quotes = buildGasTierQuotesFromPrices(1, 100n, {
    standard: 110n,
    fast: 120n,
    rapid: 130n,
  }, 'rpc', 1_000, 1_000);
  assert.throws(() => selectedGasTierQuote({
    ...quotes,
    validUntil: Date.now() + 60_000,
    tiers: { ...quotes.tiers, rapid: { ...quotes.tiers.rapid, maxPriorityFeePerGas: 999n } },
  }, 'rapid'), /unavailable/);
});

test('gas quote snapshots are cached, coalesced, and force refresh bypasses cache', async () => {
  resetGasTierQuoteCacheForTests();
  let calls = 0;
  let release!: (value: ReturnType<typeof buildGasTierQuotesFromPrices>) => void;
  const fetchSnapshot = () => {
    calls += 1;
    return new Promise<ReturnType<typeof buildGasTierQuotesFromPrices>>((resolve) => { release = resolve; });
  };
  const first = fetchGasTierQuotes(8453, { now: () => 1_000, fetchSnapshot });
  const concurrent = fetchGasTierQuotes(8453, { now: () => 1_000, fetchSnapshot });
  assert.equal(calls, 1);
  release(buildGasTierQuotesFromPrices(8453, 100n, { standard: 110n, fast: 120n, rapid: 130n }, 'rpc', 1_000, 1_000));
  const [snapshot, coalesced] = await Promise.all([first, concurrent]);
  assert.equal(snapshot, coalesced);
  assert.equal(await fetchGasTierQuotes(8453, { now: () => 1_001, fetchSnapshot }), snapshot);
  assert.equal(calls, 1);

  const refreshed = buildGasTierQuotesFromPrices(8453, 200n, { standard: 210n, fast: 220n, rapid: 230n }, 'rpc', 1_002, 1_002);
  assert.equal(await fetchGasTierQuotes(8453, { now: () => 1_002, forceRefresh: true, fetchSnapshot: async () => refreshed }), refreshed);
  assert.equal(await fetchGasTierQuotes(8453, { now: () => 1_003, fetchSnapshot }), refreshed);
  resetGasTierQuoteCacheForTests();
});
