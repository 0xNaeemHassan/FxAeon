import assert from 'node:assert/strict';
import test from 'node:test';
import { FxSdk } from '@aladdindao/fx-sdk';
import { getRpcTransport } from '../src/lib/fx/clients';
import { asFxSdkRpcTransport } from '../src/lib/fx/sdk';

function rpcFetch(failPrimary: boolean) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    const payload = JSON.parse(String(init?.body)) as { id: number; method: string };
    calls.push({ url, method: payload.method });
    if (payload.method === 'eth_chainId') {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: '0x1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (failPrimary && url.includes('/primary')) throw new TypeError('fetch failed');
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: `0x${'0'.repeat(63)}1${'0'.repeat(64)}` }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchFn };
}

test('SDK bridge quote fails over between chain-verified source RPCs', async () => {
  const primary = 'https://eth-mainnet.g.alchemy.com/v2/primary';
  const secondary = 'https://mainnet.infura.io/v3/secondary';
  const { calls, fetchFn } = rpcFetch(true);
  const urls = [primary, secondary];
  const sdk = new FxSdk({ chainId: 1, rpcUrl: primary, rpcUrls: urls, rpcTransport: asFxSdkRpcTransport(getRpcTransport(urls, 1, fetchFn)) });
  const quote = await sdk.getBridgeQuote({
    sourceChainId: 1,
    destChainId: 8453,
    token: 'fxUSD',
    amount: 10n ** 18n,
    recipient: '0x0000000000000000000000000000000000001234',
    sourceRpcUrls: [primary, secondary],
    sourceRpcTransport: asFxSdkRpcTransport(getRpcTransport(urls, 1, fetchFn)),
  });
  assert.equal(quote.nativeFee, 1n);
  assert.deepEqual(calls.map((call) => [call.url.includes('/primary') ? 'primary' : 'secondary', call.method]), [
    ['primary', 'eth_chainId'],
    ['primary', 'eth_call'],
    ['secondary', 'eth_chainId'],
    ['secondary', 'eth_call'],
  ]);
});

test('SDK never falls through to a second endpoint after a contract revert', async () => {
  const primary = 'https://eth-mainnet.g.alchemy.com/v2/primary';
  const secondary = 'https://mainnet.infura.io/v3/secondary';
  const calls: string[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const payload = JSON.parse(String(init?.body)) as { id: number; method: string };
    calls.push(payload.method);
    const body = payload.method === 'eth_chainId'
      ? { jsonrpc: '2.0', id: payload.id, result: '0x1' }
      : { jsonrpc: '2.0', id: payload.id, error: { code: -32000, message: 'execution reverted' } };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const urls = [primary, secondary];
  const sdk = new FxSdk({ chainId: 1, rpcUrl: primary, rpcUrls: urls, rpcTransport: asFxSdkRpcTransport(getRpcTransport(urls, 1, fetchFn)) });
  await assert.rejects(sdk.getBridgeQuote({
    sourceChainId: 1,
    destChainId: 8453,
    token: 'fxUSD',
    amount: 10n ** 18n,
    recipient: '0x0000000000000000000000000000000000001234',
    sourceRpcUrls: [primary, secondary],
    sourceRpcTransport: asFxSdkRpcTransport(getRpcTransport(urls, 1, fetchFn)),
  }), /revert/i);
  assert.deepEqual(calls, ['eth_chainId', 'eth_call']);
});
