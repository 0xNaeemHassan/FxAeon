import assert from 'node:assert/strict';
import test from 'node:test';
import { checkLiveGasOracle, checkLiveGasOracleWithRetry, inspectGasOracleResponse } from './check_live_gas_oracle.mjs';

const validSnapshot = {
  source: 'etherscan',
  chainId: 1,
  gasPriceWei: '12000000000',
  blockNumber: '22000000',
  fetchedAt: 1_800_000_000_000,
  stale: false,
};

test('recognizes a valid public gas-oracle snapshot without logging its payload', () => {
  assert.deepEqual(inspectGasOracleResponse(200, JSON.stringify(validSnapshot)), { configured: true });
});

test('requests only the fixed oracle URL and detects only the explicit missing-binding response', async () => {
  let observed;
  const result = await checkLiveGasOracle({
    url: 'https://fxaeon.com/api/gas',
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return new Response(JSON.stringify({ error: 'gas oracle unavailable' }), { status: 503 });
    },
  });
  assert.deepEqual(result, { configured: false });
  assert.equal(observed.url, 'https://fxaeon.com/api/gas');
  assert.equal(observed.options.method, 'GET');
  assert.equal(observed.options.redirect, 'error');
  assert.equal(observed.options.cache, 'no-store');
});

test('fails closed for upstream failures, invalid schemas, and unrelated 503 responses', () => {
  assert.throws(() => inspectGasOracleResponse(502, JSON.stringify({ error: 'gas oracle unavailable' })), /unexpected response/);
  assert.throws(() => inspectGasOracleResponse(503, JSON.stringify({ error: 'temporarily unavailable' })), /unexpected response/);
  assert.throws(() => inspectGasOracleResponse(200, JSON.stringify({ ...validSnapshot, gasPriceWei: '0' })), /schema check/);
  assert.throws(() => inspectGasOracleResponse(200, '<secret or unexpected body>'), /invalid JSON/);
});

test('post-deploy health check retries propagation briefly and stops at its configured bound', async () => {
  const statuses = [503, 200];
  let calls = 0;
  const result = await checkLiveGasOracleWithRetry({
    requireConfigured: true,
    attempts: 3,
    retryDelayMs: 0,
    fetchImpl: async () => {
      const status = statuses[calls++];
      return status === 200
        ? new Response(JSON.stringify(validSnapshot), { status })
        : new Response(JSON.stringify({ error: 'gas oracle unavailable' }), { status });
    },
  });
  assert.deepEqual(result, { configured: true });
  assert.equal(calls, 2);

  calls = 0;
  await assert.rejects(() => checkLiveGasOracleWithRetry({
    requireConfigured: true,
    attempts: 2,
    retryDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: 'gas oracle unavailable' }), { status: 503 });
    },
  }), /not configured after deployment/);
  assert.equal(calls, 2);
  await assert.rejects(() => checkLiveGasOracleWithRetry({ attempts: 11 }), /between 1 and 10/);
});
