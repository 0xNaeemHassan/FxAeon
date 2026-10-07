import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { fetchGasTierQuotes, resetGasTierQuoteCacheForTests, selectedGasTierQuote } from '../src/lib/fx/gasFeePolicy';
import { resetEthereumGasFallbackForTests } from '../src/lib/fx/etherscanGas';
import { resetPublicClientForTests } from '../src/lib/fx/clients';

const EPOCH = 1_000_000;
const RPC_URL = 'https://eth-mainnet.g.alchemy.com/v2/deterministic-local-fixture';
const BASE_RPC_URL = 'https://base-mainnet.g.alchemy.com/v2/deterministic-local-fixture';

function fixture(t: TestContext, options: {
  oracleDelay?: number;
  invalidOracle?: boolean;
  staleOracle?: boolean;
  failRpc?: boolean;
  wrongChain?: boolean;
  chainId?: 1 | 8453;
} = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: EPOCH });
  const chainId = options.chainId ?? 1;
  const events: { method: string; atMs: number }[] = [];
  const env = {
    NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL: RPC_URL,
    NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL: BASE_RPC_URL,
    NEXT_PUBLIC_ALCHEMY2_ETHEREUM_RPC_URL: '', NEXT_PUBLIC_INFURA_ETHEREUM_RPC_URL: '',
    NEXT_PUBLIC_ALCHEMY2_BASE_RPC_URL: '', NEXT_PUBLIC_INFURA_BASE_RPC_URL: '',
    NEXT_PUBLIC_FX_SCREENSHOT_MODE: '', NEXT_PUBLIC_FX_LOCAL_FORK_TEST_MODE: '',
  };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const reset = () => { resetGasTierQuoteCacheForTests(); resetEthereumGasFallbackForTests(); resetPublicClientForTests(); };
  reset();
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    reset();
  });
  const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/gas') {
      events.push({ method: '/api/gas', atMs: Date.now() - EPOCH });
      if (options.oracleDelay === undefined) return new Promise<Response>(() => undefined);
      await delay(options.oracleDelay);
      return new Response(JSON.stringify(options.invalidOracle ? {} : {
        source: 'etherscan', chainId: 1, gasPriceWei: '210', baseFeePerGasWei: '200',
        tiers: { standard: '210', fast: '220', rapid: '230' }, fetchedAt: Date.now(), stale: options.staleOracle ?? false,
      }));
    }
    assert.equal(String(input), chainId === 1 ? RPC_URL : BASE_RPC_URL);
    const body = JSON.parse(String(init?.body));
    assert.ok(['eth_chainId', 'eth_feeHistory'].includes(body.method), 'fixture must never send a transaction');
    events.push({ method: body.method, atMs: Date.now() - EPOCH });
    await delay(100);
    const result = body.method === 'eth_chainId'
      ? `0x${(options.wrongChain ? 10 : chainId).toString(16)}`
      : options.failRpc ? {} : {
        baseFeePerGas: Array(6).fill('0x64'), reward: Array(5).fill(['0xa', '0x14', '0x1e']),
      };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { headers: { 'content-type': 'application/json' } });
  });
  const advance = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 10) {
      await new Promise<void>(resolve => setImmediate(resolve));
      t.mock.timers.tick(Math.min(10, ms - elapsed));
    }
    await new Promise<void>(resolve => setImmediate(resolve));
  };
  return { events, advance };
}

test('a stalled optional oracle does not put its 4-second timeout before the 200ms RPC path', async (t) => {
  const { events, advance } = fixture(t);
  let completedAt: number | undefined;
  const pending = fetchGasTierQuotes(1).then(result => { completedAt = Date.now() - EPOCH; return result; });
  await advance(400);
  assert.equal(completedAt, 400, '200ms hedge + 100ms chain probe + 100ms fee history');
  const snapshot = await pending;
  assert.equal(snapshot.source, 'rpc');
  assert.equal(selectedGasTierQuote(snapshot, 'standard').gasPriceWei, 110n);
  assert.deepEqual(events, [
    { method: '/api/gas', atMs: 0 }, { method: 'eth_chainId', atMs: 200 }, { method: 'eth_feeHistory', atMs: 300 },
  ]);
  await advance(4_000); // The losing oracle timeout remains handled.
  assert.equal(await fetchGasTierQuotes(1), snapshot);
});

test('a fast valid oracle keeps its head start without spending an extra RPC', async (t) => {
  const { events, advance } = fixture(t, { oracleDelay: 50 });
  const pending = fetchGasTierQuotes(1);
  await advance(50);
  assert.equal((await pending).source, 'etherscan');
  await advance(1_000);
  assert.deepEqual(events, [{ method: '/api/gas', atMs: 0 }]);
});

for (const invalid of ['malformed', 'stale'] as const) {
  test(`a ${invalid} oracle starts RPC immediately and never becomes a fee quote`, async (t) => {
    const { events, advance } = fixture(t, { oracleDelay: 50, invalidOracle: invalid === 'malformed', staleOracle: invalid === 'stale' });
    const pending = fetchGasTierQuotes(1);
    await advance(250);
    assert.equal((await pending).source, 'rpc');
    assert.deepEqual(events.map(event => event.atMs), [0, 50, 150]);
  });
}

test('a failed RPC cannot beat a slower valid oracle', async (t) => {
  const { advance } = fixture(t, { oracleDelay: 1_000, failRpc: true });
  let settled = false;
  const pending = fetchGasTierQuotes(1).then(snapshot => { settled = true; return snapshot; });
  await advance(400);
  assert.equal(settled, false);
  await advance(600);
  assert.equal((await pending).source, 'etherscan');
});

test('failure of both sources remains unavailable and is not cached as a zero fee', async (t) => {
  const { events, advance } = fixture(t, { oracleDelay: 50, invalidOracle: true, failRpc: true });
  const rejected = assert.rejects(fetchGasTierQuotes(1), /fee history response is incomplete/);
  await advance(250);
  await rejected;
  const retried = assert.rejects(fetchGasTierQuotes(1), /fee history response is incomplete/);
  await advance(100);
  await retried;
  assert.equal(events.filter(event => event.method === 'eth_feeHistory').length, 2);
});

test('an RPC with the wrong chain is never used for fee history', async (t) => {
  const { events, advance } = fixture(t, { oracleDelay: 50, invalidOracle: true, wrongChain: true });
  const rejected = assert.rejects(fetchGasTierQuotes(1), /did not prove chain 1/);
  await advance(150);
  await rejected;
  assert.deepEqual(events.map(event => event.method), ['/api/gas', 'eth_chainId']);
});

test('a late valid oracle cannot replace the winning cached snapshot and concurrent callers coalesce', async (t) => {
  const { events, advance } = fixture(t, { oracleDelay: 1_000 });
  const first = fetchGasTierQuotes(1);
  const second = fetchGasTierQuotes(1);
  await advance(400);
  const snapshot = await first;
  assert.equal(await second, snapshot);
  await advance(600);
  assert.equal(await fetchGasTierQuotes(1), snapshot);
  assert.equal(snapshot.source, 'rpc');
  assert.equal(events.length, 3);
});

test('Base uses only its own RPC without an oracle or hedge delay', async (t) => {
  const { events, advance } = fixture(t, { chainId: 8453 });
  const pending = fetchGasTierQuotes(8453);
  await advance(200);
  assert.equal((await pending).chainId, 8453);
  assert.deepEqual(events, [{ method: 'eth_chainId', atMs: 0 }, { method: 'eth_feeHistory', atMs: 100 }]);
});

test('fee source arbitration works without Promise.any or AggregateError', async (t) => {
  const { events, advance } = fixture(t, { oracleDelay: 50 });
  const originalAny = Promise.any;
  const originalAggregateError = globalThis.AggregateError;
  Reflect.set(Promise, 'any', undefined);
  Reflect.set(globalThis, 'AggregateError', undefined);
  t.after(() => {
    Reflect.set(Promise, 'any', originalAny);
    Reflect.set(globalThis, 'AggregateError', originalAggregateError);
  });
  const pending = fetchGasTierQuotes(1);
  // Contain a compatibility regression until its assertion can report it.
  void pending.catch(() => undefined);
  await advance(50);
  assert.equal((await pending).source, 'etherscan');
  await advance(1_000);
  assert.deepEqual(events, [{ method: '/api/gas', atMs: 0 }]);
});
