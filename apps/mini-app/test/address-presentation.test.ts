import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compactAddress } from '../src/lib/addressPresentation';

test('compactAddress shows the first six and last four characters', () => {
  assert.equal(
    compactAddress('0x1111111111111111111111111111111111111111'),
    '0x1111…1111',
  );
});

test('compactAddress leaves already short labels intact', () => {
  assert.equal(compactAddress('0x12345678'), '0x12345678');
  assert.equal(compactAddress(''), '');
});
