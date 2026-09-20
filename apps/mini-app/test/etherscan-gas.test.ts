import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CACHE_TTL_MS,
  ETHERSCAN_API_URL,
  fetchEtherscanGasOracle,
  onRequestGet,
  resetGasOracleCacheForTests,
  STALE_MAX_AGE_MS,
} from '../../../functions/api/gas';
import {
  fetchEthereumGasFallback,
  resetEthereumGasFallbackForTests,
} from '../src/lib/fx/etherscanGas';

function upstreamResponse(result: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ status: '1', message: 'OK', result }), { status });
}

test.beforeEach(() => resetGasOracleCacheForTests());
test.beforeEach(() => resetEthereumGasFallbackForTests());
test.afterEach(() => {
  resetGasOracleCacheForTests();
  resetEthereumGasFallbackForTests();
});

test('missing server key returns 503 without contacting Etherscan', async () => {
  const response = await onRequestGet({
    request: new Request('https://fxaeon.pages.dev/api/gas'),
    env: {},
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'gas oracle unavailable' });
});

test('query parameters are rejected and cannot alter upstream parameters', async () => {
  const bad = await onRequestGet({
    request: new Request('https://fxaeon.pages.dev/api/gas?chainId=8453'),
    env: { ETHERSCAN_API_KEY: 'server-key' },
  });
  const unknown = await onRequestGet({
    request: new Request('https://fxaeon.pages.dev/api/gas?module=account'),
    env: { ETHERSCAN_API_KEY: 'server-key' },
  });
  assert.equal(bad.status, 400);
  assert.equal(unknown.status, 400);
});

test('parses the fixed Ethereum gas oracle and never returns the secret', async () => {
  let seenUrl = '';
  const snapshot = await fetchEtherscanGasOracle('server-key', {
    cache: false,
    fetchImpl: async (input) => {
      seenUrl = String(input);
      return upstreamResponse({ LastBlock: '234', ProposeGasPrice: '0.496840168' });
    },
    now: () => 1234,
  });
  const url = new URL(seenUrl);
  assert.equal(url.origin + url.pathname, ETHERSCAN_API_URL);
  assert.equal(url.searchParams.get('chainid'), '1');
  assert.equal(url.searchParams.get('module'), 'gastracker');
  assert.equal(url.searchParams.get('action'), 'gasoracle');
  assert.equal(url.searchParams.get('apikey'), 'server-key');
  assert.deepEqual(snapshot, {
    source: 'etherscan',
    chainId: 1,
    gasPriceWei: '496840168',
    blockNumber: '234',
    fetchedAt: 1234,
    stale: false,
  });
});

test('upstream errors become an unavailable response without echoing upstream data', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('network outage'); }) as typeof fetch;
  try {
    const response = await onRequestGet({
      request: new Request('https://fxaeon.pages.dev/api/gas'),
      env: { ETHERSCAN_API_KEY: 'server-key' },
    });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'gas oracle unavailable' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('serves a bounded stale cache during a temporary upstream failure', async () => {
  let now = 10_000;
  let fail = false;
  const fetchImpl = async () => {
    if (fail) throw new Error('network outage');
    return upstreamResponse({ LastBlock: '10', ProposeGasPrice: '1.25' });
  };
  const first = await fetchEtherscanGasOracle('server-key', { fetchImpl, now: () => now });
  assert.equal(first.stale, false);
  now += CACHE_TTL_MS + 1;
  fail = true;
  const stale = await fetchEtherscanGasOracle('server-key', { fetchImpl, now: () => now });
  assert.equal(stale.gasPriceWei, '1250000000');
  assert.equal(stale.stale, true);
  now += STALE_MAX_AGE_MS + 1;
  await assert.rejects(
    fetchEtherscanGasOracle('server-key', { fetchImpl, now: () => now }),
    /network|upstream request failed/,
  );
});

test('rejects oversized upstream gas and block numbers before bigint conversion', async () => {
  await assert.rejects(
    fetchEtherscanGasOracle('server-key', {
      cache: false,
      fetchImpl: async () => upstreamResponse({
        LastBlock: '9'.repeat(1000),
        ProposeGasPrice: '9'.repeat(1000),
      }),
    }),
    /invalid gas price|no gas data/,
  );
});

test('browser fallback accepts only a fresh bounded snapshot', async () => {
  const response = () => new Response(JSON.stringify({
    source: 'etherscan',
    chainId: 1,
    gasPriceWei: '1250000000',
    blockNumber: '10',
    fetchedAt: 100_000,
    stale: false,
  }));
  const snapshot = await fetchEthereumGasFallback({ fetchImpl: async (_input, init) => {
    assert.equal(init?.redirect, 'error');
    return response();
  }, now: () => 100_000 });
  assert.equal(snapshot.gasPriceWei, '1250000000');

  resetEthereumGasFallbackForTests();
  await assert.rejects(
    fetchEthereumGasFallback({
      fetchImpl: async () => new Response(JSON.stringify({
        source: 'etherscan', chainId: 1, gasPriceWei: '1250000000', fetchedAt: 100_001_000, stale: false,
      })),
      now: () => 100_000,
    }),
    /invalid data/,
  );
});

test('server and browser requests enforce a timeout when a fetch implementation ignores abort', async () => {
  await assert.rejects(
    fetchEtherscanGasOracle('server-key', {
      cache: false,
      timeoutMs: 250,
      fetchImpl: () => new Promise<Response>(() => {}),
    }),
    /timed out/,
  );
  resetEthereumGasFallbackForTests();
  await assert.rejects(
    fetchEthereumGasFallback({
      timeoutMs: 250,
      fetchImpl: () => new Promise<Response>(() => {}),
      now: () => 100_000,
    }),
    /timed out/,
  );
});

test('server rejects an invalid injected clock instead of publishing an unbounded timestamp', async () => {
  await assert.rejects(
    fetchEtherscanGasOracle('server-key', {
      cache: false,
      fetchImpl: async () => upstreamResponse({ ProposeGasPrice: '1' }),
      now: () => Number.NaN,
    }),
    /timestamp/,
  );
});
