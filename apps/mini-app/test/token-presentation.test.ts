import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenName, tokenPresentation, tokenSymbol } from '@/lib/fx/tokenPresentation';

test('Earn assets have distinct user-facing identities', () => {
  assert.notEqual(tokenSymbol('fxUSD'), tokenSymbol('fxUSDBasePool'));
  assert.notEqual(tokenName('fxUSD'), tokenName('fxUSDBasePool'));
  assert.match(tokenPresentation('fxUSDBasePool').role, /pool share/i);
});
