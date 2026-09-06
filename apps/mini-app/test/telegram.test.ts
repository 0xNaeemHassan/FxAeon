import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openExternalLink, waitForTelegramWebApp, type TgWebApp } from '../src/lib/telegram';

type FakeWindow = {
  Telegram?: { WebApp?: TgWebApp };
  open?: (url: string, target?: string, features?: string) => unknown;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
};

function installWindow(webApp?: TgWebApp): { fake: FakeWindow; restore: () => void } {
  const globalObject = globalThis as unknown as { window?: FakeWindow };
  const previous = globalObject.window;
  const fake: FakeWindow = { Telegram: webApp ? { WebApp: webApp } : undefined, setInterval, clearInterval };
  globalObject.window = fake;
  return {
    fake,
    restore: () => {
      if (previous) globalObject.window = previous;
      else delete globalObject.window;
    },
  };
}

function bridge(): TgWebApp {
  return { initData: 'signed', platform: 'tdesktop' } as TgWebApp;
}

test('Telegram bridge availability resolves immediately when already present', async () => {
  const { restore } = installWindow(bridge());
  try {
    assert.equal(await waitForTelegramWebApp(50), (globalThis as unknown as { window: FakeWindow }).window.Telegram?.WebApp);
  } finally {
    restore();
  }
});

test('Telegram bridge availability tolerates a delayed host injection', async () => {
  const { fake, restore } = installWindow();
  try {
    const pending = waitForTelegramWebApp(500);
    setTimeout(() => { fake.Telegram = { WebApp: bridge() }; }, 20);
    assert.ok(await pending);
  } finally {
    restore();
  }
});

test('Telegram bridge availability fails closed after a bounded timeout', async () => {
  const { restore } = installWindow();
  try {
    assert.equal(await waitForTelegramWebApp(20), null);
  } finally {
    restore();
  }
});

test('external links use Telegram openLink when the host provides it', () => {
  const linkCalls: string[] = [];
  const webApp = { ...bridge(), openLink: (url: string) => linkCalls.push(url) } as TgWebApp;
  const { restore } = installWindow(webApp);
  try {
    assert.equal(openExternalLink('https://etherscan.io/tx/0xabc'), true);
    assert.deepEqual(linkCalls, ['https://etherscan.io/tx/0xabc']);
  } finally {
    restore();
  }
});

test('external links reject non-HTTPS URLs without opening a browser target', () => {
  let opened = false;
  const { fake, restore } = installWindow();
  fake.open = () => { opened = true; return {}; };
  try {
    assert.equal(openExternalLink('javascript:alert(1)'), false);
    assert.equal(opened, false);
  } finally {
    restore();
  }
});
