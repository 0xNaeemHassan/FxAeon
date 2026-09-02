import playwright from '../apps/mini-app/node_modules/@playwright/test/index.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'docs', 'assets');
const baseUrl = process.env.FX_SCREENSHOT_BASE_URL ?? 'http://localhost:4321';

const browser = await playwright.chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: 'dark',
  locale: 'en-US',
  timezoneId: 'UTC',
  reducedMotion: 'reduce',
});

await context.route('**/telegram-web-app.js', (route) => route.fulfill({
  status: 200,
  contentType: 'text/javascript',
  body: '/* documentation capture: plain browser */',
}));

await context.route('https://coins.llama.fi/**', async (route) => {
  const encodedIds = new URL(route.request().url()).pathname.split('/prices/current/')[1] ?? '';
  const ids = decodeURIComponent(encodedIds).split(',').filter(Boolean);
  const timestamp = Math.floor(Date.now() / 1000);
  const coins = Object.fromEntries(ids.map((id) => {
    const normalised = id.toLowerCase();
    const price = normalised.includes('2260fac5e5542a773aa44fbcfedf7c193bc2c599')
      ? 104_240
      : normalised.includes('c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2')
        ? 2_485.42
        : normalised.includes('ae7ab96520de3a18e5e111b5eaab095312d7fe84')
          ? 2_485.42
        : normalised.includes('7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0')
            ? 2_944.19
            : 1;
    return [id, { price, timestamp, confidence: 0.99 }];
  }));
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ coins }) });
});

const page = await context.newPage();

async function capture(file, route, prepare) {
  await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
  await page.locator('main').last().waitFor({ state: 'visible' });
  await prepare?.(page);
  await page.screenshot({ path: path.join(output, file), fullPage: false });
}

await capture('fxaeon-web.png', '/');
await capture('fxaeon-trade.png', '/trade', async (current) => {
  await current.getByLabel('Amount in ETH').fill('1.25');
  await current.getByLabel('Input asset').click();
  await current.getByRole('dialog', { name: 'Input asset' }).waitFor({ state: 'visible' });
});
await capture('fxaeon-bridge.png', '/move');
await capture('fxaeon-login.png', '/login');
await capture('fxaeon-portfolio.png', '/portfolio');

await browser.close();
process.stdout.write(`Captured documentation screens from ${baseUrl}\n`);
