import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalMoveSourceTokenAddress,
  createMoveBalanceReadGuard,
  readCanonicalMoveBalances,
} from '../src/lib/moveBalances';
import type { FxPublicClient } from '../src/lib/fx/types';

const wallet = '0x930f0000000000000000000000000000000098b9';

function injectedClient(chainId: number, read: (address: string) => Promise<bigint>) {
  const calls: string[] = [];
  return {
    calls,
    client: {
      getChainId: async () => chainId,
      readContract: async ({ address }: { address: string }) => {
        calls.push(address);
        return read(address);
      },
    } as unknown as Pick<FxPublicClient, 'getChainId' | 'readContract'>,
  };
}

test('uses the Ethereum underlying token and Base OFT for canonical source balances', async () => {
  const ethereum = injectedClient(1, async () => 12n);
  const ethResult = await readCanonicalMoveBalances({ walletAddress: wallet, sourceChainId: 1, client: ethereum.client });
  assert.equal(ethResult.status, 'ready');
  assert.deepEqual(ethereum.calls, [
    canonicalMoveSourceTokenAddress('fxUSD', 1),
    canonicalMoveSourceTokenAddress('fxSAVE', 1),
  ]);

  const base = injectedClient(8453, async () => 9n);
  const baseResult = await readCanonicalMoveBalances({ walletAddress: wallet, sourceChainId: 8453, client: base.client });
  assert.equal(baseResult.status, 'ready');
  assert.deepEqual(base.calls, [
    canonicalMoveSourceTokenAddress('fxUSD', 8453),
    canonicalMoveSourceTokenAddress('fxSAVE', 8453),
  ]);
  assert.notEqual(ethereum.calls[0], base.calls[0]);
});

test('probes the requested chain and preserves partial read failures', async () => {
  const partial = injectedClient(1, async (address) => {
    if (address === canonicalMoveSourceTokenAddress('fxSAVE', 1)) throw new Error('timeout');
    return 0n;
  });
  const result = await readCanonicalMoveBalances({ walletAddress: wallet, sourceChainId: 1, client: partial.client });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.balances.fxUSD, { status: 'ready', amount: '0' });
  assert.equal(result.balances.fxSAVE.status, 'unavailable');

  const wrongChain = injectedClient(8453, async () => 1n);
  await assert.rejects(
    () => readCanonicalMoveBalances({ walletAddress: wallet, sourceChainId: 1, client: wrongChain.client }),
    /expected 1/,
  );
});

test('invalidating and reactivating never lets an old wallet read win', () => {
  const guard = createMoveBalanceReadGuard();
  const oldRequest = guard.begin();
  assert.ok(oldRequest !== null);
  guard.invalidate();
  guard.activate();
  const newRequest = guard.begin();
  assert.ok(newRequest !== null);
  assert.equal(guard.isCurrent(oldRequest!), false);
  assert.equal(guard.isCurrent(newRequest!), true);
});

test('does not let automatic refreshes supersede a pending read, but force does', () => {
  const guard = createMoveBalanceReadGuard();
  const first = guard.begin();
  assert.ok(first !== null);
  assert.equal(guard.begin(), null);
  const forced = guard.begin(true);
  assert.ok(forced !== null);
  assert.equal(guard.isCurrent(first!), false);
  guard.finish(first!);
  assert.equal(guard.isCurrent(forced!), true);
  guard.finish(forced!);
  assert.ok(guard.begin() !== null);
});
