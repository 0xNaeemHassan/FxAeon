import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restoreTelegramLaunchHash } from '../src/lib/telegram';

function installLaunch(initData: string, hash = '') {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const writes: unknown[][] = [];
  const state = { route: '/more' };
  const fake = {
    Telegram: { WebApp: { initData } },
    location: { pathname: '/more', search: '?view=wallet', hash },
    history: {
      state,
      replaceState: (...args: unknown[]) => { writes.push(args); },
    },
    open: () => { throw new Error('Native reconnect must not open a web login'); },
  };
  Object.defineProperty(globalThis, 'window', { value: fake, configurable: true });
  return { fake, writes, state, restore() {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  } };
}

test('native reconnect prepares only the current document for seamless authentication', () => {
  const launch = installLaunch('query_id=synthetic-test&user=fixture&hash=not-a-credential', '#tgWebAppData=old-fixture');
  try {
    assert.equal(restoreTelegramLaunchHash(), true);
    assert.deepEqual(launch.writes, [[launch.state, '',
      '/more?view=wallet#tgWebAppData=query_id%3Dsynthetic-test%26user%3Dfixture%26hash%3Dnot-a-credential']]);
  } finally { launch.restore(); }
});

test('native reconnect fails closed when launch data or local handoff is unavailable', () => {
  const launch = installLaunch('');
  try {
    assert.equal(restoreTelegramLaunchHash(), false);
    assert.equal(launch.writes.length, 0);
    launch.fake.Telegram.WebApp.initData = 'synthetic-test';
    launch.fake.history.replaceState = () => { throw new Error('History unavailable'); };
    assert.equal(restoreTelegramLaunchHash(), false);
  } finally { launch.restore(); }
});

test('preparing the same native launch twice leaves browser history intact', () => {
  const launch = installLaunch('synthetic-test', '#tgWebAppData=synthetic-test');
  try {
    assert.equal(restoreTelegramLaunchHash(), true);
    assert.deepEqual(launch.writes, []);
  } finally { launch.restore(); }
});
