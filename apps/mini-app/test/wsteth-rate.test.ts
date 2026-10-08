import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readEthLongAccounting } from '../src/lib/fx/ethLongAccounting';
import { positionPoolAddress } from '../src/lib/fx/policy';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import { parseStEthPerWstEth, stEthForWstEth } from '../src/lib/fx/wstEthRate';

// wstETH.stEthPerToken() on mainnet at block 26,150,567 (9 October 2026);
// the PoolManager's wstETH rate provider returned the same value.
const RATE = 1_245_861_716_930_919_999n;

test('a rate is a live read within bounds, never a guess and never 1:1', () => {
  assert.equal(parseStEthPerWstEth(RATE), RATE);
  assert.equal(parseStEthPerWstEth(RATE.toString()), RATE);
  for (const unusable of [undefined, null, 0n, -RATE, 10n ** 18n, 10n * 10n ** 18n, '', '0', '1000000000000000000', '1.245861716930919999', '-1245861716930919999', '0x1149f', 1.2458, '9'.repeat(41)]) {
    assert.equal(parseStEthPerWstEth(unusable), undefined, String(unusable));
  }
});

test('wstETH converts to stETH at the rate, rounded down to the wei', () => {
  assert.equal(stEthForWstEth(670_412_512_785_242_112n, RATE), 835_241_284_230_594_092n);
  assert.equal(stEthForWstEth(10n ** 18n, RATE), RATE);
  // 3 wei × 1.5 is 4.5 wei: a floor or an estimate never rounds up.
  assert.equal(stEthForWstEth(3n, 1_500_000_000_000_000_000n), 4n);
  assert.equal(stEthForWstEth(0n, RATE), 0n);
});

type Read = { address: string; functionName: string; args?: readonly unknown[] };
function client(answer: (read: Read) => Promise<unknown>) {
  const reads: Read[] = [];
  return {
    reads,
    client: { readContract: ((read: Read) => { reads.push(read); return answer(read); }) as never },
  };
}

test('the planner reads the wstETH rate and an existing position’s held collateral, as decimal strings', async () => {
  const fake = client(async (read) => read.functionName === 'stEthPerToken' ? RATE : [9_176_999_662_367_526_796n, 12_712n * 10n ** 18n]);
  assert.deepEqual(await readEthLongAccounting({ heldPositionId: 2033, client: fake.client }), {
    stEthPerWstEth: '1245861716930919999',
    currentColls: '9176999662367526796',
  });
  assert.deepEqual(fake.reads.map(({ address, functionName, args }) => ({ address: address.toLowerCase(), functionName, args })), [
    { address: FX_TOKENS.wstETH.address.toLowerCase(), functionName: 'stEthPerToken', args: undefined },
    { address: positionPoolAddress('ETH', 'long').toLowerCase(), functionName: 'getPosition', args: [2033n] },
  ]);
  // A new position holds nothing yet: only the rate is read.
  const opening = client(async () => RATE);
  assert.deepEqual(await readEthLongAccounting({ heldPositionId: 0, client: opening.client }), { stEthPerWstEth: '1245861716930919999' });
  assert.deepEqual(opening.reads.map((read) => read.functionName), ['stEthPerToken']);
});

test('a failed, stalled or unusable read leaves its figure out, so the review keeps the native unit', async () => {
  const failingRate = client(async (read) => {
    if (read.functionName === 'stEthPerToken') throw new Error('execution reverted');
    return [5n, 6n];
  });
  assert.deepEqual(await readEthLongAccounting({ heldPositionId: 7, client: failingRate.client }), { currentColls: '5' });
  const oneToOne = client(async () => 10n ** 18n);
  assert.deepEqual(await readEthLongAccounting({ client: oneToOne.client }), {});
  const malformed = client(async (read) => read.functionName === 'stEthPerToken' ? 'not a rate' : 'not a position');
  assert.deepEqual(await readEthLongAccounting({ heldPositionId: 7, client: malformed.client }), {});
  const stalled = client(() => new Promise(() => undefined));
  const started = Date.now();
  assert.deepEqual(await readEthLongAccounting({ heldPositionId: 7, client: stalled.client, deadlineMs: 20 }), {});
  assert.ok(Date.now() - started < 2_000, 'a stalled read is abandoned at its deadline');
  const throwing = { readContract: (() => { throw new Error('no transport'); }) as never };
  assert.deepEqual(await readEthLongAccounting({ client: throwing }), {});
});
