import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearEip6963AnnouncementsForTest,
  eip6963FocusTrapDestination,
  getDiscoveredEip6963Providers,
  recordEip6963Announcement,
  selectEip6963Provider,
  shouldBindEip6963ProviderEvents,
  shouldPromptEip6963Provider,
  waitForWalletProvider,
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
  assert.equal(shouldBindEip6963ProviderEvents('com.unknown'), false);
  assert.equal(shouldPromptEip6963Provider('com.second'), false);
  assert.equal(shouldBindEip6963ProviderEvents('com.second'), true);
  assert.equal(selectEip6963Provider('com.second')?.provider, second);
  assert.equal(selectEip6963Provider('com.unknown'), undefined);
});

test('missing provider metadata gets a safe local fallback and never requests an icon', () => {
  clearEip6963AnnouncementsForTest();
  const item = recordEip6963Announcement({ provider: provider() });
  assert.equal(item?.name, 'Browser wallet');
  assert.match(item?.rdns ?? '', /^unknown-wallet-\d+$/);
});

test('chooser focus trap redirects Tab and Shift+Tab when focus starts outside the dialog', () => {
  assert.equal(eip6963FocusTrapDestination({ activeInside: false, atFirst: false, atLast: false, shiftKey: false }), 'first');
  assert.equal(eip6963FocusTrapDestination({ activeInside: false, atFirst: false, atLast: false, shiftKey: true }), 'last');
  assert.equal(eip6963FocusTrapDestination({ activeInside: true, atFirst: true, atLast: false, shiftKey: true }), 'last');
  assert.equal(eip6963FocusTrapDestination({ activeInside: true, atFirst: false, atLast: true, shiftKey: false }), 'first');
});

test('wallet provider wait resolves when a delayed EIP-6963 announcement arrives', async () => {
  const target = new EventTarget();
  let delayed: Eip6963Announcement['provider'];
  const pending = waitForWalletProvider(() => delayed, target, { pollMs: 5, timeoutMs: 250 });
  setTimeout(() => {
    delayed = provider();
    target.dispatchEvent(new Event('eip6963:announceProvider'));
  }, 30);
  assert.equal(await pending, delayed);
});
