import assert from 'node:assert/strict';
import test from 'node:test';
import { createAlchemyChainPulse, deriveAlchemyWebSocketUrl, realtimeReconnectDelay, TRANSFER_TOPIC, type RealtimeChainEvent, type RealtimeChainState } from '../src/lib/realtimeChain';

test('derives reviewed Alchemy websocket URLs and rejects wrong chains or hosts', () => {
  assert.equal(deriveAlchemyWebSocketUrl(1, 'https://eth-mainnet.g.alchemy.com/v2/browser_key'), 'wss://eth-mainnet.g.alchemy.com/v2/browser_key');
  assert.equal(deriveAlchemyWebSocketUrl(8453, 'https://base-mainnet.g.alchemy.com/v2/browser_key'), 'wss://base-mainnet.g.alchemy.com/v2/browser_key');
  assert.equal(deriveAlchemyWebSocketUrl(1, 'https://base-mainnet.g.alchemy.com/v2/browser_key'), null);
  assert.equal(deriveAlchemyWebSocketUrl(1, 'https://example.com/v2/browser_key'), null);
  assert.equal(deriveAlchemyWebSocketUrl(1, 'https://eth-mainnet.g.alchemy.com/v2/browser_key?x=1'), null);
});

test('uses the canonical ERC-20 Transfer topic and bounded reconnect backoff', () => {
  assert.equal(TRANSFER_TOPIC, '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
  assert.ok(realtimeReconnectDelay(0, () => 0) < realtimeReconnectDelay(8, () => 1));
  assert.ok(realtimeReconnectDelay(100, () => 1) <= 30_000 * 1.2);
});

test('requires subscription acknowledgements, validates wallet logs, and cancels every timer on pause', () => {
  const previous = process.env.NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL;
  process.env.NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL = 'https://eth-mainnet.g.alchemy.com/v2/browser_key';
  const events: RealtimeChainEvent[] = [], states: RealtimeChainState[] = [];
  const timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  let timerId = 0;
  const sockets: { onopen: (() => void) | null; onmessage: ((event: { data?: unknown }) => void) | null; onerror: (() => void) | null; onclose: (() => void) | null; send: () => void; close: () => void }[] = [];
  const pulse = createAlchemyChainPulse({ chainId: 1, walletAddress: '0x0000000000000000000000000000000000001234', onEvent: (event) => events.push(event), onState: (state) => states.push(state),
    createSocket: () => { const socket = { onopen: null, onmessage: null, onerror: null, onclose: null, send() {}, close() {} }; sockets.push(socket); return socket; },
    schedule: (callback) => { const id = ++timerId as unknown as ReturnType<typeof setTimeout>; timers.set(id, callback); return id; }, cancelSchedule: (id) => { timers.delete(id); } });
  try {
    pulse.setActive(true);
    const socket = sockets[0]; socket.onopen?.();
    assert.equal(states.at(-1)?.status, 'connecting');
    const message = (payload: unknown) => socket.onmessage?.({ data: JSON.stringify(payload) });
    for (const id of [1, 2, 3]) message({ id, result: `sub${id}` });
    assert.equal(states.at(-1)?.status, 'live');
    message({ method: 'eth_subscription', params: { subscription: 'sub1', result: {} } });
    assert.equal(events.length, 0);
    message({ method: 'eth_subscription', params: { subscription: 'sub1', result: { number: '0x10' } } });
    const topics = [TRANSFER_TOPIC, `0x${'1234'.padStart(64, '0')}`, `0x${'abcd'.padStart(64, '0')}`];
    message({ method: 'eth_subscription', params: { subscription: 'sub2', result: { topics, blockNumber: '0xf', removed: true } } });
    assert.equal(events.at(-1)?.removed, true);
    assert.equal(events.at(-1)?.kind, 'transfer');
    const lateMessage = socket.onmessage;
    pulse.setActive(false);
    assert.equal(timers.size, 0);
    lateMessage?.({ data: JSON.stringify({ method: 'eth_subscription', params: { subscription: 'sub1', result: { number: '0x11' } } }) });
    assert.equal(events.length, 2);
    pulse.setActive(true); sockets[1].onopen?.();
    sockets[1].onmessage?.({ data: JSON.stringify({ id: 1, error: { code: -1 } }) });
    assert.equal(states.at(-1)?.status, 'polling');
    assert.equal(timers.size, 1);
    pulse.stop(); assert.equal(timers.size, 0);
  } finally { pulse.stop(); if (previous === undefined) delete process.env.NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL; else process.env.NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL = previous; }
});
