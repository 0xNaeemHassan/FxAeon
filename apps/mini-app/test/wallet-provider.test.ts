import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearEip6963AnnouncementsForTest,
  getDiscoveredEip6963Providers,
  recordEip6963Announcement,
  selectEip6963Provider,
  shouldPromptEip6963Provider,
  type Eip6963Announcement,
} from '../src/lib/wallet/eip6963';

function provider(): Eip6963Announcement['provider'] {
  return { request: async () => [] };
}

test('EIP-6963 discovery deduplicates provider objects and sanitizes labels', () => {
  clearEip6963AnnouncementsForTest();
  const wallet = provider()!;
  const first = recordEip6963Announcement({ provider: wallet, info: { name: 'Meta\u0000Mask', rdns: 'io.metamask' } });
  assert.equal(recordEip6963Announcement({ provider: wallet, info: { name: 'Duplicate' } }), null);
  assert.equal(first?.name, 'MetaMask');
  assert.equal(getDiscoveredEip6963Providers().length, 1);
});

test('a valid preferred rdns selects directly while multiple unchosen providers prompt', () => {
  clearEip6963AnnouncementsForTest();
  const first = provider()!;
  const second = provider()!;
  recordEip6963Announcement({ provider: first, info: { name: 'First', rdns: 'com.first' } });
  recordEip6963Announcement({ provider: second, info: { name: 'Second', rdns: 'com.second' } });
  assert.equal(shouldPromptEip6963Provider('com.unknown'), true);
  assert.equal(shouldPromptEip6963Provider('com.second'), false);
  assert.equal(selectEip6963Provider('com.second')?.provider, second);
  assert.equal(selectEip6963Provider('com.unknown'), undefined);
});

test('missing provider metadata gets a safe local fallback and never requests an icon', () => {
  clearEip6963AnnouncementsForTest();
  const item = recordEip6963Announcement({ provider: provider() });
  assert.equal(item?.name, 'Browser wallet');
  assert.match(item?.rdns ?? '', /^unknown-wallet-\d+$/);
});
