/** Offline fixture: runs the real wallet reader and shared HTTP transport. */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createPublicClient, decodeFunctionData, encodeFunctionResult, erc20Abi, multicall3Abi, type Hex } from 'viem';
import { mainnet } from 'viem/chains';
import { QueryObserver } from '@tanstack/react-query';
import { getRpcTransport } from '../../src/lib/fx/clients';
import { createWalletDataConfig } from '../../src/lib/web3/config';
import { canonicalWalletAssetQueryOptions, createWalletQueryClient, readWagmiWalletBalances, walletBalanceQueryOptions } from '../../src/lib/web3/walletQueries';

const address = '0x0000000000000000000000000000000000001234';
const delayMs = 40;
const samples = 9;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function fixture() {
  const calls: string[] = [];
  const fetchFn: typeof fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as { id: number; method: string; params?: [{ data?: Hex }] };
    calls.push(payload.method);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    let result: unknown;
    if (payload.method === 'eth_chainId') result = '0x1';
    else if (payload.method === 'eth_getBalance') result = '0x1234';
    else if (payload.method === 'eth_call') {
      const decoded = decodeFunctionData({ abi: multicall3Abi, data: payload.params![0].data! });
      assert.equal(decoded.functionName, 'aggregate3');
      result = encodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', result: (decoded.args[0] as readonly unknown[]).map(() => ({ success: true, returnData: encodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', result: 123456789012345678901n }) })) });
    } else throw new Error(`Unexpected fixture method ${payload.method}`);
    return Response.json({ jsonrpc: '2.0', id: payload.id, result });
  };
  const client = createPublicClient({ chain: mainnet, transport: getRpcTransport(['https://eth-mainnet.g.alchemy.com/v2/offline-fixture'], 1, fetchFn) });
  return { calls, client, config: createWalletDataConfig(() => client) };
}
async function main() {
for (const mode of ['cold-wallet', 'warm-wallet', 'expired-wallet', 'cold-shared-observers'] as const) {
  const timings: number[] = [];
  const counts: Record<string, number>[] = [];
  let reference = '';
  for (let sample = 0; sample < samples; sample++) {
    const { calls, config } = fixture();
    const realNow = Date.now;
    const queryClient = createWalletQueryClient();
    try {
      if (mode === 'warm-wallet' || mode === 'expired-wallet') {
        await readWagmiWalletBalances(config, address, 1);
        calls.length = 0;
      }
      if (mode === 'expired-wallet') Date.now = () => realNow() + 61_000;
      const started = performance.now();
      let result;
      if (mode === 'cold-shared-observers') {
        const exact = new QueryObserver(queryClient, walletBalanceQueryOptions(config, 'session', address));
        const canonical = new QueryObserver(queryClient, canonicalWalletAssetQueryOptions(config, 'session', address, 1));
        const unsubscribeExact = exact.subscribe(() => undefined);
        const unsubscribeCanonical = canonical.subscribe(() => undefined);
        const results = await Promise.all([exact.refetch(), canonical.refetch()]);
        result = results[0].data;
        assert.equal(results[1].data?.balances.length, result?.balances.length);
        unsubscribeExact(); unsubscribeCanonical();
      } else result = await readWagmiWalletBalances(config, address, 1);
      timings.push(performance.now() - started);
      const serialized = JSON.stringify(result, (_, value) => typeof value === 'bigint' ? value.toString() : value);
      if (reference) assert.equal(serialized, reference); else reference = serialized;
      counts.push(Object.fromEntries([...new Set(calls)].map(method => [method, calls.filter(value => value === method).length])));
    } finally { Date.now = realNow; queryClient.clear(); }
  }
  assert.ok(counts.every(count => JSON.stringify(count) === JSON.stringify(counts[0])));
  console.log(JSON.stringify({ mode, samples, fixtureRoundTripMs: delayMs, medianMs: Number(median(timings).toFixed(2)), minMs: Number(Math.min(...timings).toFixed(2)), maxMs: Number(Math.max(...timings).toFixed(2)), counts: counts[0], result: JSON.parse(reference) }));
}

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
