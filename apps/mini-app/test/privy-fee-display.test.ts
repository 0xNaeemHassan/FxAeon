import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/@privy-io/react-auth/dist');
type Fee = (tx: Record<string, unknown>) => bigint | undefined;

for (const bundle of ['esm/index-DEvxmE29.mjs', 'cjs/index-BJnyd0R8.js']) {
  const source = readFileSync(resolve(dist, bundle), 'utf8');
  const start = source.indexOf('function fxaeonExecutionFeeWei(tx)');
  assert.ok(start >= 0, `installed ${bundle} must include the fee display correction`);
  // Exercise the installed package's pure helper, not a second implementation.
  const fee = new Function(`${source.slice(start)}; return fxaeonExecutionFeeWei;`)() as Fee;

  test(`${bundle}: gas units become native fee wei without changing the signing request`, () => {
    const tx = Object.freeze({ gas: 1_602_923n, maxFeePerGas: 160_858_794n, maxPriorityFeePerGas: 0n });
    assert.equal(fee(tx), 257_844_260_654_862n);
    assert.equal(tx.gas, 1_602_923n);
    // Historical receipt values serve only as a regression example, never a default.
    assert.equal(fee({ gas: 1_220_128n, gasPrice: 87_181_771n }), 106_372_919_886_688n);
    assert.match(source, /totalGasEstimate:fxaeonExecutionFeeWei\(/);
    assert.doesNotMatch(source, /totalGasEstimate:\w+\.gas[,}]/);
  });

  test(`${bundle}: changing fee tiers or gas demand changes the displayed fee`, () => {
    for (const gas of [21_000n, 500_000n, 1_200_000n]) {
      const prices = [80_000_000n, 120_000_000n, 190_000_000n];
      assert.deepEqual(prices.map((maxFeePerGas) => fee({ gas, maxFeePerGas })), prices.map((p) => gas * p));
    }
    assert.equal(fee({ gas: '0x5208', gasPrice: '0x3b9aca00' }), 21_000_000_000_000n);
    assert.equal(fee({ gas: 21_000n, maxFeePerGas: 2n, gasPrice: 99n }), 42_000n);
  });

  test(`${bundle}: missing or malformed estimates stay unavailable rather than looking free`, () => {
    for (const tx of [{}, { gas: 21_000n }, { gas: 0n, gasPrice: 1n }, { gas: 1n, gasPrice: -1n }, { gas: 'invalid', gasPrice: 1n }]) {
      assert.equal(fee(tx), undefined);
    }
    assert.match(source, /totalGasEstimate===undefined\?"Unavailable"/);
  });
}
