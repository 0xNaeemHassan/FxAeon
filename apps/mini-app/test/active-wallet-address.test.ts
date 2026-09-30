import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeWalletAddress } from '../src/lib/wallet/activeWalletAddress';

const detectedAddress = '0x0000000000000000000000000000000000000001';

test('header identity stays hidden until the wallet session is connected and ready', () => {
  assert.equal(activeWalletAddress({ ready: true, authenticated: false, address: detectedAddress }), undefined);
  assert.equal(activeWalletAddress({ ready: false, authenticated: true, address: detectedAddress }), undefined);
  assert.equal(activeWalletAddress({ ready: true, authenticated: true, address: detectedAddress }), detectedAddress);
  assert.equal(activeWalletAddress({ ready: true, authenticated: false }), undefined);
});
