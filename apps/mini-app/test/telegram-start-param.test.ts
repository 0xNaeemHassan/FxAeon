import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  claimTelegramStartRoute,
  launchStartRequest,
  readTelegramStartRequest,
  startParamRoute,
  takeTelegramStartHref,
  webAppStartRequest,
  type TgWebApp,
} from '../src/lib/telegram';

type ClaimStorage = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };

/** Session storage shared by the documents of one Telegram webview. */
function sessionStorage(): ClaimStorage {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

/** A fresh document: its own claim, the session's storage. */
const freshDocument = (storage: ClaimStorage) => ({ storage, state: { claimed: false } });

function installPage(href: string) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const url = new URL(href);
  const writes: unknown[][] = [];
  const state = { __NA: true };
  const fake = {
    location: { href: url.href, origin: url.origin, pathname: url.pathname, search: url.search, hash: url.hash },
    history: { state, replaceState: (...args: unknown[]) => { writes.push(args); } },
  };
  Object.defineProperty(globalThis, 'window', { value: fake, configurable: true });
  return {
    fake,
    state,
    writes,
    restore() {
      if (previous) Object.defineProperty(globalThis, 'window', previous);
      else Reflect.deleteProperty(globalThis, 'window');
    },
  };
}

/** Telegram's launch hash: signed launch data plus the client's parameters. */
function launchHash(data: Record<string, string>): string {
  return `#tgWebAppData=${encodeURIComponent(new URLSearchParams(data).toString())}&tgWebAppVersion=8.0&tgWebAppPlatform=android`;
}

test('start parameters open only the listed screens, at fixed same-origin paths', () => {
  assert.deepEqual(
    Object.fromEntries(['portfolio', 'trade', 'trade-eth', 'trade-btc', 'positions', 'earn', 'borrow', 'move', 'history'].map((value) => [value, startParamRoute(value)])),
    {
      portfolio: '/', trade: '/trade', 'trade-eth': '/trade?market=ETH', 'trade-btc': '/trade?market=BTC',
      positions: '/positions', earn: '/earn', borrow: '/borrow', move: '/move', history: '/history',
    },
  );
  for (const value of [
    '', 'Trade', 'TRADE', ' trade', 'trade ', 'trade/', '/trade', 'trade?market=SOL', 'trade#top', '../trade', 'trade-sol',
    '//evil.example', 'https://evil.example/trade', 'javascript:alert(1)', 'data:text/html,x', '%2F%2Fevil.example',
    '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'settings', 'send', 'qr', 'login', 'docs', 'a'.repeat(512),
  ]) {
    assert.equal(startParamRoute(value), null, `${JSON.stringify(value)} must not route`);
  }
  for (const value of [undefined, null, 1, true, {}, ['trade'], { toString: () => 'trade' }]) assert.equal(startParamRoute(value), null);
});

test('a launch URL carries the start parameter in its query and in its launch data', () => {
  const data = { query_id: 'AAH_fixture', user: '{"id":777}', auth_date: '1700000000', start_param: 'earn', hash: 'fixture' };
  assert.deepEqual(readTelegramStartRequest('?tgWebAppStartParam=earn', launchHash(data)), { startParam: 'earn', launchId: '1700000000' });
  assert.deepEqual(readTelegramStartRequest('', launchHash(data)), { startParam: 'earn', launchId: '1700000000' });
  assert.deepEqual(readTelegramStartRequest('?tgWebAppStartParam=move', ''), { startParam: 'move', launchId: '' });
  assert.equal(readTelegramStartRequest('', ''), null);
  assert.equal(readTelegramStartRequest('?market=BTC', '#tgWebAppVersion=8.0&tgWebAppPlatform=ios'), null);
  assert.equal(readTelegramStartRequest('?tgWebAppStartParam=', launchHash({ auth_date: '1700000000' })), null);
  // Only Telegram's numeric auth_date identifies a launch.
  assert.deepEqual(readTelegramStartRequest('?tgWebAppStartParam=trade', launchHash({ auth_date: '17e8', start_param: 'trade' })), { startParam: 'trade', launchId: '' });
  // Parsing never trusts the value; routing decides through the list.
  assert.deepEqual(readTelegramStartRequest('?tgWebAppStartParam=%2F%2Fevil.example', ''), { startParam: '//evil.example', launchId: '' });
});

test('the bridge reports a launch the same way', () => {
  assert.deepEqual(webAppStartRequest({ initDataUnsafe: { start_param: 'borrow', auth_date: 1700000000 } } as TgWebApp), { startParam: 'borrow', launchId: '1700000000' });
  assert.deepEqual(webAppStartRequest({ initDataUnsafe: { start_param: 'borrow', auth_date: '1700000000' } } as TgWebApp), { startParam: 'borrow', launchId: '1700000000' });
  assert.equal(webAppStartRequest({ initDataUnsafe: {} } as TgWebApp), null);
  assert.equal(webAppStartRequest({ initData: '' } as TgWebApp), null);
  assert.equal(webAppStartRequest(null), null);
  // Outside a browser the module reads no launch.
  assert.equal(launchStartRequest(), null);
});

test('a launch opens its start screen once, and a reload of that launch does not open it again', () => {
  const storage = sessionStorage();
  const launch = { startParam: 'trade', launchId: '1700000001' };
  const firstDocument = freshDocument(storage);
  assert.equal(claimTelegramStartRoute(launch, firstDocument), '/trade');
  // The bridge's copy of the same launch, later in the same document.
  assert.equal(claimTelegramStartRoute({ ...launch }, firstDocument), null);
  // Telegram's Reload: a new document with the same launch data and session.
  assert.equal(claimTelegramStartRoute(launch, freshDocument(storage)), null);
  // A later launch in the same session (Telegram Web keeps one tab) has a new auth_date.
  assert.equal(claimTelegramStartRoute({ startParam: 'earn', launchId: '1700000099' }, freshDocument(storage)), '/earn');
});

test('an unlisted start parameter routes nowhere and does not use up the launch', () => {
  const storage = sessionStorage();
  const entry = freshDocument(storage);
  assert.equal(claimTelegramStartRoute({ startParam: '//evil.example', launchId: '1700000002' }, entry), null);
  assert.equal(claimTelegramStartRoute(null, entry), null);
  assert.equal(entry.state.claimed, false);
  assert.equal(storage.getItem('fxaeon:telegram-start'), null);
  assert.equal(claimTelegramStartRoute({ startParam: 'history', launchId: '1700000002' }, entry), '/history');
});

test('without session storage a start screen still opens only once per document', () => {
  const denied: ClaimStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  const state = { claimed: false };
  assert.equal(claimTelegramStartRoute({ startParam: 'move', launchId: '1700000003' }, { storage: denied, state }), '/move');
  assert.equal(claimTelegramStartRoute({ startParam: 'move', launchId: '1700000003' }, { storage: denied, state }), null);
});

test('the start screen opens over the entry page and keeps the launch hash for sign-in', () => {
  const hash = launchHash({ auth_date: '1700000004', start_param: 'trade-btc', hash: 'fixture' });
  const page = installPage(`https://fxaeon.com/?tgWebAppStartParam=trade-btc${hash}`);
  try {
    const request = readTelegramStartRequest(page.fake.location.search, page.fake.location.hash);
    assert.equal(takeTelegramStartHref(request, freshDocument(sessionStorage())), `/trade?market=BTC${hash}`);
    // The handled parameter leaves the entry's URL, and the router's history state is kept.
    assert.deepEqual(page.writes, [[page.state, '', `/${hash}`]]);
  } finally {
    page.restore();
  }
});

test('nothing navigates when the start screen is already showing', () => {
  const home = installPage(`https://fxaeon.com/?tgWebAppStartParam=portfolio${launchHash({ auth_date: '1700000005' })}`);
  try {
    assert.equal(takeTelegramStartHref({ startParam: 'portfolio', launchId: '1700000005' }, freshDocument(sessionStorage())), null);
    assert.equal(home.writes.length, 1, 'The parameter is still forgotten');
  } finally {
    home.restore();
  }
  const trade = installPage('https://fxaeon.com/trade?market=BTC');
  try {
    assert.equal(takeTelegramStartHref({ startParam: 'trade-btc', launchId: '1700000006' }, freshDocument(sessionStorage())), null);
    assert.equal(trade.writes.length, 0);
  } finally {
    trade.restore();
  }
});

test('a hash the router cannot decode is left behind', () => {
  const page = installPage('https://fxaeon.com/?tgWebAppStartParam=earn#%E0%A4%A');
  try {
    assert.equal(takeTelegramStartHref({ startParam: 'earn', launchId: '1700000007' }, freshDocument(sessionStorage())), '/earn');
  } finally {
    page.restore();
  }
});

test('reloading after a start screen opened leaves the visitor where they went', () => {
  const storage = sessionStorage();
  const hash = launchHash({ auth_date: '1700000008', start_param: 'earn', hash: 'fixture' });
  const launch = installPage(`https://fxaeon.com/?tgWebAppStartParam=earn${hash}`);
  try {
    const request = readTelegramStartRequest(launch.fake.location.search, launch.fake.location.hash);
    assert.equal(takeTelegramStartHref(request, freshDocument(storage)), `/earn${hash}`);
  } finally {
    launch.restore();
  }
  // The visitor moved on to Borrow and reloaded; the launch data came back with the page.
  const reload = installPage(`https://fxaeon.com/borrow${hash}`);
  try {
    const request = readTelegramStartRequest(reload.fake.location.search, reload.fake.location.hash);
    assert.deepEqual(request, { startParam: 'earn', launchId: '1700000008' });
    assert.equal(takeTelegramStartHref(request, freshDocument(storage)), null);
    // telegram-web-app.js restores the same launch for the bridge after a reload.
    const bridge = { initDataUnsafe: { start_param: 'earn', auth_date: '1700000008' } } as TgWebApp;
    assert.equal(takeTelegramStartHref(webAppStartRequest(bridge), freshDocument(storage)), null);
    assert.equal(reload.writes.length, 0);
  } finally {
    reload.restore();
  }
});
