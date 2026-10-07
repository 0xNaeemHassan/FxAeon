import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const root = resolve(__dirname, '../../../..');
const appRoot = resolve(root, 'apps/mini-app');
const appRequire = createRequire(resolve(appRoot, 'package.json'));
const esbuild = createRequire(appRequire.resolve('tsx/package.json'))('esbuild') as {
  build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }>;
};

let bundle = '';
test.beforeAll(async () => {
  const result = await esbuild.build({
    stdin: {
      contents: `
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { useLiveMarketQuote } from './src/components/PriceProvider';
        import { liveMarketStore } from './src/lib/liveMarketStore';
        window.marketRenders = { ETH: 0, BTC: 0 };
        window.publishMarketQuote = (market, sequence) => liveMarketStore.acceptQuote({
          market, productId: market === 'ETH' ? 'ETH-USD' : 'BTC-USD',
          price: market === 'ETH' ? 2400 : 104000,
          open24h: 2300, high24h: 105000, low24h: 2200, percentChange24h: 1,
          sequence, sourceAt: Date.now(), receivedAt: Date.now(), source: 'coinbase'
        });
        window.setMarketStatus = (status) => liveMarketStore.setStatus(status);
        function Quote({ market }) {
          const live = useLiveMarketQuote(market);
          window.marketRenders[market] += 1;
          return <output data-testid={market}>{live.quote?.sequence ?? 0}:{live.isFresh ? 'fresh' : 'stale'}</output>;
        }
        flushSync(() => createRoot(document.getElementById('root')).render(<><Quote market="ETH" /><Quote market="BTC" /></>));
      `,
      resolveDir: appRoot,
      loader: 'tsx',
    },
    bundle: true, write: false, format: 'iife', platform: 'browser',
    target: 'es2020', jsx: 'automatic', tsconfig: resolve(appRoot, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  bundle = result.outputFiles[0].text;
});

type MarketHarness = {
  marketRenders: { ETH: number; BTC: number };
  publishMarketQuote: (market: 'ETH' | 'BTC', sequence: number) => void;
  setMarketStatus: (status: 'live' | 'reconnecting') => void;
};

test('BTC-only ticks do not rerender ETH consumers, while each instrument still expires', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-01T12:00:00.000Z') });
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => {
    const harness = window as typeof window & MarketHarness;
    harness.setMarketStatus('live');
    harness.publishMarketQuote('ETH', 1);
    harness.publishMarketQuote('BTC', 1);
  });
  await page.clock.runFor(1);
  await expect(page.getByTestId('ETH')).toHaveText('1:fresh');
  const before = await page.evaluate(() => ({ ...(window as typeof window & MarketHarness).marketRenders }));
  for (let sequence = 2; sequence <= 21; sequence += 1) {
    await page.clock.runFor(300);
    await page.evaluate((next) => (window as typeof window & MarketHarness).publishMarketQuote('BTC', next), sequence);
    await page.clock.runFor(1);
    await expect(page.getByTestId('BTC')).toHaveText(`${sequence}:fresh`);
  }
  const after = await page.evaluate(() => (window as typeof window & MarketHarness).marketRenders);
  expect(after.ETH - before.ETH).toBe(0);
  expect(after.BTC - before.BTC).toBe(20);
  await page.clock.runFor(14000);
  await expect(page.getByTestId('ETH')).toHaveText('1:stale');
  await expect(page.getByTestId('BTC')).toHaveText('21:fresh');
  await page.clock.runFor(6020);
  await expect(page.getByTestId('BTC')).toHaveText('21:stale');
});
