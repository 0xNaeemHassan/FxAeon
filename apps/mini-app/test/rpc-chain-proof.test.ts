import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicClient } from 'viem';
import { base, mainnet } from 'viem/chains';
import { getRpcTransport } from '../src/lib/fx/clients';

const primary = 'https://eth-mainnet.g.alchemy.com/v2/chain-proof-primary';
const secondary = 'https://mainnet.infura.io/v3/chain-proof-secondary';
const address = '0x0000000000000000000000000000000000001234';
type Call = { url: string; id: number; method: string };
function fixture(reply?: (call: Call, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string };
    const call = { url: String(input), ...body };
    calls.push(call);
    return reply ? reply(call, init) : Response.json({ jsonrpc: '2.0', id: call.id, result: call.method === 'eth_chainId' ? '0x1' : '0x5' });
  };
  const client = createPublicClient({ chain: mainnet, transport: getRpcTransport([primary], 1, fetchFn) });
  return { calls, fetchFn, client };
}

test('a cold explicit chain guard proves its endpoint in one request, then allows balances', async () => {
  const { client, calls } = fixture();
  assert.equal(await client.getChainId(), 1);
  assert.equal(await client.getBalance({ address }), 5n);
  assert.deepEqual(calls.map(call => call.method), ['eth_chainId', 'eth_getBalance']);
});

test('warm and expired guards still make fresh network requests without caching chain identity answers', async () => {
  const { client, calls } = fixture();
  await client.getChainId(); await client.getChainId();
  const now = Date.now;
  try { Date.now = () => now() + 61_000; await client.getChainId(); }
  finally { Date.now = now; }
  assert.deepEqual(calls.map(call => call.method), ['eth_chainId', 'eth_chainId', 'eth_chainId']);
});

test('an ordinary cold read still proves its endpoint before sending financial data', async () => {
  const { client, calls } = fixture();
  assert.equal(await client.getBalance({ address }), 5n);
  assert.deepEqual(calls.map(call => call.method), ['eth_chainId', 'eth_getBalance']);
});

test('concurrent guard and ordinary read share the proof while every explicit guard is retained', async () => {
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const first = new Promise<void>(resolve => { started = resolve; });
  const { client, calls, fetchFn } = fixture(async call => {
    if (call.method === 'eth_chainId') { started(); await blocked; }
    return Response.json({ jsonrpc: '2.0', id: call.id, result: call.method === 'eth_chainId' ? '0x1' : '0x5' });
  });
  const guard = client.getChainId();
  await first;
  const balance = client.getBalance({ address });
  const otherClient = createPublicClient({ chain: mainnet, transport: getRpcTransport([primary], 1, fetchFn) });
  const nextGuard = otherClient.getChainId();
  await Promise.resolve();
  assert.equal(calls.length, 1);
  release();
  assert.deepEqual(await Promise.all([guard, balance, nextGuard]), [1, 5n, 1]);
  assert.equal(calls.filter(call => call.method === 'eth_chainId').length, 2);
  assert.equal(calls.filter(call => call.method === 'eth_getBalance').length, 1);
});

test('wrong-chain guard fails over once and never authorizes data on the wrong endpoint', async () => {
  const { calls, fetchFn } = fixture(call => Response.json({ jsonrpc: '2.0', id: call.id, result: call.method === 'eth_chainId' ? call.url === primary ? '0x2105' : '0x1' : '0x5' }));
  const client = createPublicClient({ chain: mainnet, transport: getRpcTransport([primary, secondary], 1, fetchFn) });
  assert.equal(await client.getChainId(), 1);
  assert.equal(await client.getBalance({ address }), 5n);
  assert.deepEqual(calls.map(call => [call.url, call.method]), [[primary, 'eth_chainId'], [secondary, 'eth_chainId'], [secondary, 'eth_getBalance']]);
});

test('chain proofs remain separated by expected chain, URL and fetch implementation', async () => {
  const { calls, fetchFn } = fixture();
  const first = createPublicClient({ chain: mainnet, transport: getRpcTransport([primary], 1, fetchFn) });
  const otherUrl = createPublicClient({ chain: mainnet, transport: getRpcTransport([secondary], 1, fetchFn) });
  const wrongChain = createPublicClient({ chain: base, transport: getRpcTransport([primary], 8453, fetchFn) });
  await first.getChainId(); await otherUrl.getChainId();
  await assert.rejects(wrongChain.getBalance({ address }));
  assert.equal(calls.filter(call => call.method === 'eth_chainId').length, 3);
  assert.equal(calls.filter(call => call.method === 'eth_getBalance').length, 0);
  const independent = fixture();
  await independent.client.getChainId();
  assert.equal(independent.calls.length, 1);
});

for (const failure of ['wrong-chain', 'malformed', 'rpc-error', 'http-error'] as const) {
  test(`a ${failure} proof cannot unlock dependent reads and failed proofs recover after cooldown`, async () => {
    let failed = true;
    const { client, calls } = fixture(call => {
      if (failed) {
        if (failure === 'malformed') return new Response('{bad json');
        if (failure === 'rpc-error') return Response.json({ jsonrpc: '2.0', id: call.id, error: { code: -32603, message: 'unavailable' } });
        if (failure === 'http-error') return new Response('unavailable', { status: 503 });
        return Response.json({ jsonrpc: '2.0', id: call.id, result: '0x2105' });
      }
      return Response.json({ jsonrpc: '2.0', id: call.id, result: call.method === 'eth_chainId' ? '0x1' : '0x5' });
    });
    await assert.rejects(client.getChainId());
    await assert.rejects(client.getBalance({ address }));
    assert.deepEqual(calls.map(call => call.method), ['eth_chainId']);
    failed = false;
    const now = Date.now;
    try {
      Date.now = () => now() + 5_001;
      assert.equal(await client.getChainId(), 1);
      assert.equal(await client.getBalance({ address }), 5n);
    } finally { Date.now = now; }
    assert.deepEqual(calls.map(call => call.method), ['eth_chainId', 'eth_chainId', 'eth_getBalance']);
  });
}

test('a direct guard retains the 1.5-second probe deadline and cannot release a dependent read on timeout', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | null | undefined;
  const { client, calls } = fixture((_call, init) => new Promise((_resolve, reject) => {
    signal = init?.signal;
    signal?.addEventListener('abort', () => reject(signal?.reason), { once: true });
  }));
  const guard = client.getChainId().then(() => false, () => true);
  while (!signal) await new Promise(resolve => setImmediate(resolve));
  const dependent = client.getBalance({ address }).then(() => false, () => true);
  context.mock.timers.tick(1_499);
  assert.equal(signal.aborted, false);
  context.mock.timers.tick(1);
  assert.equal(signal.aborted, true);
  assert.deepEqual(await Promise.all([guard, dependent]), [true, true]);
  assert.deepEqual(calls.map(call => call.method), ['eth_chainId']);
});

test('an errored response cannot prove identity even if it also contains the expected chain', async () => {
  const { client, calls } = fixture(call => Response.json({ jsonrpc: '2.0', id: call.id, result: '0x1', error: { code: -32603, message: 'unavailable' } }));
  await assert.rejects(client.getChainId());
  await assert.rejects(client.getBalance({ address }));
  assert.deepEqual(calls.map(call => call.method), ['eth_chainId']);
});

test('a guard joining an ordinary proof still makes its own uncached request', async () => {
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const first = new Promise<void>(resolve => { started = resolve; });
  const { client, calls } = fixture(async call => {
    if (call.method === 'eth_chainId') { started(); await blocked; }
    return Response.json({ jsonrpc: '2.0', id: call.id, result: call.method === 'eth_chainId' ? '0x1' : '0x5' });
  });
  const balance = client.getBalance({ address });
  await first;
  const guard = client.getChainId();
  release();
  assert.deepEqual(await Promise.all([balance, guard]), [5n, 1]);
  assert.equal(calls.filter(call => call.method === 'eth_chainId').length, 2);
  assert.equal(calls.filter(call => call.method === 'eth_getBalance').length, 1);
});

test('the proof deadline covers a stalled response body and fails over before releasing data', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | null | undefined;
  const { calls, fetchFn } = fixture((call, init) => {
    if (call.url === primary) {
      signal = init?.signal;
      return new Response(new ReadableStream({ start(controller) {
        signal?.addEventListener('abort', () => controller.error(signal?.reason), { once: true });
      } }));
    }
    return Response.json({ jsonrpc: '2.0', id: call.id, result: call.method === 'eth_chainId' ? '0x1' : '0x5' });
  });
  const client = createPublicClient({ chain: mainnet, transport: getRpcTransport([primary, secondary], 1, fetchFn) });
  const guard = client.getChainId();
  while (!signal) await new Promise(resolve => setImmediate(resolve));
  const dependent = client.getBalance({ address });
  context.mock.timers.tick(1_500);
  assert.deepEqual(await Promise.all([guard, dependent]), [1, 5n]);
  assert.equal(signal.aborted, true);
  assert.deepEqual(calls.map(call => [call.url, call.method]), [[primary, 'eth_chainId'], [secondary, 'eth_chainId'], [secondary, 'eth_getBalance']]);
});

test('explicit caller cancellation aborts proof decoding and cannot release dependent data', async context => {
  // The probe deadline never fires here, so only the caller's own abort can settle the proof.
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const abort = new AbortController();
  let signal: AbortSignal | null | undefined;
  const { client, calls } = fixture((_call, init) => {
    signal = init?.signal;
    return new Response(new ReadableStream({ start(controller) {
      signal?.addEventListener('abort', () => controller.error(signal?.reason), { once: true });
    } }));
  });
  const guard = client.request({ method: 'eth_chainId' }, { signal: abort.signal }).then(() => false, () => true);
  while (!signal) await new Promise(resolve => setImmediate(resolve));
  const dependent = client.getBalance({ address }).then(() => false, () => true);
  abort.abort();
  assert.deepEqual(await Promise.all([guard, dependent]), [true, true]);
  assert.equal(signal.aborted, true);
  assert.deepEqual(calls.map(call => call.method), ['eth_chainId']);
});

test('a late body from an abort-ignoring transport cannot establish fresh proof', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | null | undefined;
  let release!: () => void;
  const { client, calls } = fixture((call, init) => {
    signal = init?.signal;
    return new Response(new ReadableStream({ start(controller) {
      release = () => {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ jsonrpc: '2.0', id: call.id, result: '0x1' })));
        controller.close();
      };
    } }));
  });
  const guard = client.getChainId().then(() => false, () => true);
  while (!signal) await new Promise(resolve => setImmediate(resolve));
  const dependent = client.getBalance({ address }).then(() => false, () => true);
  context.mock.timers.tick(1_500);
  assert.equal(signal.aborted, true);
  release();
  assert.deepEqual(await Promise.all([guard, dependent]), [true, true]);
  assert.deepEqual(calls.map(call => call.method), ['eth_chainId']);
});
