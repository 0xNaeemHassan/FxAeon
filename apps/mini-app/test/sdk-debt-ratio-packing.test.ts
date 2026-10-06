import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const sdkDist = resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/@aladdindao/fx-sdk/dist');
const UINT60_LIMIT = 1n << 60n;
const UINT60_MAX = UINT60_LIMIT - 1n;
const WAD = 10n ** 18n;
type Encoder = (min: unknown, max: unknown) => string;

function installedEncoder(bundle: 'index.js' | 'index.cjs'): Encoder {
  const source = readFileSync(resolve(sdkDist, bundle), 'utf8');
  const start = source.indexOf('var getEncodeMiscData = ');
  const end = source.indexOf('var getEncodeMiscDataWithSlippage = ', start);
  assert.ok(start >= 0 && end > start, `could not inspect the installed ${bundle} debt-ratio helper`);
  const helper = source.slice(start, end).trim();
  assert.ok(helper.endsWith('};'), `unexpected installed ${bundle} helper boundary`);
  // Execute only this pure, internal helper, never an SDK/provider module.
  // A stale unpatched installation fails here rather than silently passing
  // against a separately reimplemented formatter or a patch file on disk.
  return new Function('cBN', `"use strict"; ${helper}\nreturn getEncodeMiscData;`)(() => {
    throw new Error(`installed ${bundle} debt-ratio packing still uses lossy Decimal arithmetic`);
  }) as Encoder;
}

function assertRoundTrip(encode: Encoder, min: bigint, max: bigint): void {
  const result = encode(min.toString(), max.toString());
  assert.equal(typeof result, 'string', 'the SDK helper must preserve its string return contract');
  const packed = BigInt(result);
  assert.equal(packed, (max << 60n) | min, 'packing must not round or widen either bound');
  assert.equal(packed & UINT60_MAX, min, 'low 60 bits must retain the exact minimum');
  assert.equal((packed >> 60n) & UINT60_MAX, max, 'next 60 bits must retain the exact maximum');
  assert.ok(packed < (1n << 120n), 'packing cannot spill into higher flags');
}

for (const bundle of ['index.js', 'index.cjs'] as const) {
  test(`installed ${bundle} packs zero, equal, and uint60 boundary values losslessly`, () => {
    const encode = installedEncoder(bundle);
    for (const [min, max] of [
      [0n, 0n], [0n, 1n], [1n, 1n], [0n, UINT60_MAX],
      [UINT60_MAX - 1n, UINT60_MAX], [UINT60_MAX, UINT60_MAX],
      [WAD - 1n, WAD], [WAD, WAD + 1n],
    ]) assertRoundTrip(encode, min, max);
    assert.equal(encode('0001', '0002'), encode('1', '2'));
  });

  test(`installed ${bundle} retains representative leverage/slippage bounds across a deterministic sweep`, () => {
    const encode = installedEncoder(bundle);
    // LSD leverage L corresponds to debt ratio L/(1+L). The helper only
    // packs the caller's integer bounds; it must not recalculate the range.
    for (const [numerator, denominator] of [[1n, 10n], [1n, 2n], [1n, 1n], [2n, 1n], [5n, 1n], [6n, 1n]]) {
      const base = numerator * WAD / (numerator + denominator);
      for (const slippageBps of [1n, 10n, 100n, 500n]) {
        for (let index = 0n; index < 64n; index += 1n) {
          const target = base + index * 1_234_567_891n;
          const min = target * 10_000n / (10_000n + slippageBps);
          const max = target * 10_000n / (10_000n - slippageBps);
          assertRoundTrip(encode, min, max);
        }
      }
    }
  });

  test(`installed ${bundle} rejects malformed, inverted, and overflowing bounds`, () => {
    const encode = installedEncoder(bundle);
    for (const invalid of [undefined, null, false, 1, 1n, NaN, Infinity, '', ' ', '-1', '+1', '1.0', '1e18', '0x10', '1_000', '1\n', {}, []]) {
      assert.throws(() => encode(invalid, '10'), TypeError);
      assert.throws(() => encode('0', invalid), TypeError);
    }
    assert.throws(() => encode('2', '1'), /Minimum debt ratio cannot exceed maximum/);
    for (const overflow of [UINT60_LIMIT.toString(), (UINT60_LIMIT + 1n).toString(), '9'.repeat(80)]) {
      assert.throws(() => encode('0', overflow), /fit uint60/);
      assert.throws(() => encode(overflow, overflow), /fit uint60/);
    }
  });
}

test('default Decimal precision demonstrably corrupts a valid 60-bit debt-ratio range', () => {
  const sdkRequire = createRequire(realpathSync(resolve(sdkDist, 'index.cjs')));
  const Decimal = sdkRequire('decimal.js');
  const originalPrecision = Decimal.precision;
  // Clone isolates the demonstrator; never mutate the shared SDK Decimal.
  const LegacyDecimal = Decimal.clone({ precision: 20, rounding: 4 });
  const min = 329949991123456789n;
  const max = 336649990923456789n;
  const validRatio = 333333333333333333n;
  const rounded = BigInt(new LegacyDecimal(max.toString())
    .times(new LegacyDecimal(2).pow(60)).plus(min.toString()).toFixed(0));
  assert.equal(rounded & UINT60_MAX, 334782144128679936n);
  assert.ok(validRatio >= min && validRatio <= max, 'the intended range admits the ratio');
  assert.ok(validRatio < (rounded & UINT60_MAX), 'the rounded packed range wrongly rejects the ratio');
  for (const bundle of ['index.js', 'index.cjs'] as const) {
    const packed = BigInt(installedEncoder(bundle)(min.toString(), max.toString()));
    assert.ok(validRatio >= (packed & UINT60_MAX) && validRatio <= (packed >> 60n));
    assertRoundTrip(installedEncoder(bundle), min, max);
  }
  assert.equal(Decimal.precision, originalPrecision, 'the shared Decimal configuration must remain unchanged');
});
