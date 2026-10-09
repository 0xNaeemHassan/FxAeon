import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const telegramModule = require.resolve('../src/lib/telegram');

type Launch = {
  search?: string;
  hash?: string;
  initData?: string;
  platform?: string;
  userAgent?: string;
  proxy?: boolean;
};

/** Each document must capture its own initial launch before navigation. */
function documentWithLaunch(launch: Launch = {}) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const fake = {
    location: { search: launch.search ?? '', hash: launch.hash ?? '' },
    Telegram: { WebApp: { initData: launch.initData ?? '', platform: launch.platform ?? 'unknown' } },
    ...(launch.proxy ? { TelegramWebviewProxy: {} } : {}),
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fake });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: launch.userAgent ?? 'Chrome' } });
  delete require.cache[telegramModule];
  const telegram = require(telegramModule) as typeof import('../src/lib/telegram');
  return {
    fake,
    hasLaunchData: telegram.hasTelegramMiniAppLaunchData,
    restore() {
      delete require.cache[telegramModule];
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else Reflect.deleteProperty(globalThis, 'window');
      if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
      else Reflect.deleteProperty(globalThis, 'navigator');
    },
  };
}

test('wallet routing ignores Telegram user-agent, proxy, platform, theme, and script-stub hints without launch data', () => {
  for (const launch of [
    {},
    { userAgent: 'Telegram-Android/11.0' },
    { proxy: true },
    { platform: 'tdesktop' },
    { search: '?tgWebAppPlatform=android&tgWebAppVersion=8.0', hash: '#tgWebAppThemeParams=%7B%7D' },
    { search: '?tgWebAppData=', hash: '#tgWebAppData=%20%20' },
    { initData: '   ', platform: 'ios' },
    { search: '?returnTo=%23tgWebAppData%3Dsynthetic' },
  ]) {
    const document = documentWithLaunch(launch);
    try { assert.equal(document.hasLaunchData(), false, JSON.stringify(launch)); }
    finally { document.restore(); }
  }
});

test('wallet routing accepts nonempty bridge data and launch data from query or hash', () => {
  for (const launch of [
    { initData: 'synthetic-test-data' },
    { search: '?tgWebAppData=query_id%3Dsynthetic%26hash%3Dfixture' },
    { hash: '#tgWebAppData=query_id%3Dsynthetic%26hash%3Dfixture&tgWebAppVersion=8.0' },
    { hash: '#tgWebAppData=&tgWebAppData=synthetic-test-data' },
  ]) {
    const document = documentWithLaunch(launch);
    try { assert.equal(document.hasLaunchData(), true, JSON.stringify(launch)); }
    finally { document.restore(); }
  }
});

test('initial launch data survives navigation consuming the query or hash', () => {
  for (const launch of [{ search: '?tgWebAppData=synthetic-test-data' }, { hash: '#tgWebAppData=synthetic-test-data' }]) {
    const document = documentWithLaunch(launch);
    try {
      document.fake.location.search = '';
      document.fake.location.hash = '';
      assert.equal(document.hasLaunchData(), true);
    } finally { document.restore(); }
  }
});

test('the detector observes current launch data when the bridge or URL arrives after module evaluation', () => {
  const document = documentWithLaunch();
  try {
    assert.equal(document.hasLaunchData(), false);
    document.fake.location.hash = '#tgWebAppData=synthetic-test-data';
    assert.equal(document.hasLaunchData(), true);
    document.fake.location.hash = '';
    document.fake.Telegram.WebApp.initData = 'synthetic-bridge-data';
    assert.equal(document.hasLaunchData(), true);
  } finally { document.restore(); }
});

test('server evaluation has no Mini App launch data', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    Reflect.deleteProperty(globalThis, 'window');
    delete require.cache[telegramModule];
    const telegram = require(telegramModule) as typeof import('../src/lib/telegram');
    assert.equal(telegram.hasTelegramMiniAppLaunchData(), false);
  } finally {
    delete require.cache[telegramModule];
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
  }
});
