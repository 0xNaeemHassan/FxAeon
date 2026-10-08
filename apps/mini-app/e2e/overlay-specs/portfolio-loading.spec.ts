import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { buildPortfolioStatesLab, type PortfolioStatesLab } from '../harness/portfolio-states-build';

/*
 * Portfolio's first load against inline mock providers (see
 * e2e/harness/portfolio-states-build.ts): the provider fallback, the live page
 * while the wallet starts, every read in flight, and settled reads. Each test
 * loads one state per page so module caches never carry between states.
 */
const publicRoot = resolve(__dirname, '../../public');
let lab: PortfolioStatesLab;

test.beforeAll(async () => { lab = await buildPortfolioStatesLab(); });

async function open(page: Page, stage: string, { route = '/portfolio', theme = 'official' } = {}) {
  const html = `<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/lab.css"></head>`
    + `<body><div id="root"></div><script>window.__portfolioStates = ${JSON.stringify({ stage, route, theme })};</script><script src="/lab.js"></script></body></html>`;
  await page.route('http://lab.test/**', async (request) => {
    const path = new URL(request.request().url()).pathname;
    if (path === '/') return request.fulfill({ contentType: 'text/html', body: html });
    if (path === '/lab.css') return request.fulfill({ contentType: 'text/css', body: lab.css });
    if (path === '/lab.js') return request.fulfill({ contentType: 'text/javascript', body: lab.script });
    const file = resolve(publicRoot, `.${decodeURIComponent(path)}`);
    if (!existsSync(file)) return request.fulfill({ status: 404, body: '' });
    return request.fulfill({ contentType: extname(file) === '.svg' ? 'image/svg+xml' : 'image/png', body: readFileSync(file) });
  });
  await page.goto('http://lab.test/');
  await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
}

/** Boxes of the landmarks a reader's eye holds onto while Portfolio loads. */
async function portfolioLandmarks(page: Page) {
  return page.evaluate(() => {
    const box = (element: Element | null | undefined) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)];
    };
    const content = document.querySelector('.app-content')!;
    const headings = [...content.querySelectorAll('h1, h2')].filter((heading) => heading.getBoundingClientRect().width > 2);
    return {
      heading: box(content.querySelector('h1')),
      figure: box(content.querySelector('.missing-value-xl .missing-value-bar')),
      actions: [...content.querySelectorAll('[class*="quickAction"] > span')].map(box),
      summaries: [...content.querySelectorAll('details > summary')].map(box),
      sectionHeadings: headings.map(box),
      networkTabs: box(content.querySelector('[class*="networkTabs"]')),
      assetRows: [...content.querySelectorAll('[class*="loadingRow"]')].map(box),
      historyRows: [...content.querySelectorAll('ul li')].map(box),
      marketCards: [...content.querySelectorAll('.portfolio-market-card')].map(box),
      borrow: box(content.querySelector('[class*="rowGroup"]')),
      topBarActions: box(document.querySelector('.app-topbar-actions')),
      dock: box(document.querySelector('.tabbar')),
    };
  });
}

for (const width of [320, 393, 480, 1280]) {
  test(`the first paint draws Portfolio in the place the live page takes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1700 });
    await open(page, 'provider');
    const fallback = await portfolioLandmarks(page);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await open(page, 'wallet');
    const live = await portfolioLandmarks(page);
    // Everything below the top bar sits exactly where the live page puts it.
    expect({ ...fallback, topBarActions: null }).toEqual({ ...live, topBarActions: null });
    expect(fallback.figure).not.toBeNull();
    expect(fallback.actions).toHaveLength(4);
    expect(fallback.assetRows).toHaveLength(3);
    // The wallet control keeps its height; its width only follows the label text.
    expect(fallback.topBarActions![3]).toBe(live.topBarActions![3]);
    expect(Math.abs(fallback.topBarActions![2] - live.topBarActions![2])).toBeLessThanOrEqual(8);
  });
}

test('placeholders hold the loaded figure line, so the page does not move when values land', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 1400 });
  const measure = async (stage: string) => {
    await open(page, stage);
    const result = await page.evaluate(() => {
      const top = (selector: string) => Math.round(document.querySelector(selector)!.getBoundingClientRect().top * 10) / 10;
      return { figure: document.querySelector('[data-portfolio-value]')!.getBoundingClientRect().height, actions: top('[class*="quickActions"]'), assets: top('#portfolio-assets-heading') };
    });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    return result;
  };
  const reads = await measure('reads');
  const loaded = await measure('loaded');
  const unavailable = await measure('unavailable');
  expect(loaded).toEqual(reads);
  expect(unavailable).toEqual(reads);
});

test('the live page takes over the first paint without fading in a second time', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await open(page, 'handoff');
  // The fallback itself arrives with the route fade; let that finish first.
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.app-content > *')!).opacity)).toBe('1');
  const samples = await page.evaluate(`(async () => {
    const read = () => {
      const content = document.querySelector('.app-content > *');
      const bar = document.querySelector('.missing-value-xl .missing-value-bar');
      return { opacity: Number(getComputedStyle(content).opacity), bar: Math.round(bar.getBoundingClientRect().top) };
    };
    const out = [read()];
    window.__portfolioStates.handoff();
    for (let frame = 0; frame < 10; frame += 1) { await new Promise((done) => requestAnimationFrame(() => done())); out.push(read()); }
    return out;
  })()`) as Array<{ opacity: number; bar: number }>;
  await expect(page.getByRole('button', { name: 'Refresh portfolio balances and positions' })).toBeAttached();
  for (const sample of samples) expect(sample).toEqual(samples[0]);
  expect(samples[0].opacity).toBe(1);
});

test('reads that fail end every placeholder: each section says so with a retry', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 1500 });
  await open(page, 'unavailable');
  await expect(page.getByText('Total unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(2);
  await expect(page.getByText('Couldn’t load balances', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Positions' }).getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(page.locator('section[aria-labelledby="portfolio-earn-heading"]').getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('History couldn’t load. Your transactions are unaffected.', { exact: true })).toBeVisible();
  await expect(page.getByText('Chart unavailable', { exact: true })).toHaveCount(2);
  // Nothing is left shimmering once its read has failed.
  await expect(page.locator('main .missing-value-bar, main .skeleton, main .market-chart-skeleton')).toHaveCount(0);
});

test('an empty wallet is told what is missing and how to start, never shown a placeholder', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 1500 });
  await open(page, 'empty');
  await expect(page.getByText('No assets yet', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Receive assets' })).toBeVisible();
  await expect(page.getByText('0 fxSAVE on Ethereum', { exact: true })).toBeVisible();
  await expect(page.getByText('No activity yet', { exact: true })).toBeVisible();
  await expect(page.locator('main .missing-value-bar, main .skeleton')).toHaveCount(0);
});

test('reduced motion leaves placeholders still and the hero light in place', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 393, height: 1200 });
  await open(page, 'reads');
  const styles = await page.evaluate(() => [...document.querySelectorAll('.skeleton, .missing-value-bar, .market-chart-skeleton')].map((element) => {
    const style = getComputedStyle(element);
    return `${style.animationName}|${style.backgroundImage}`;
  }));
  expect(styles.length).toBeGreaterThan(10);
  expect(new Set(styles)).toEqual(new Set(['none|none']));
  const light = await page.evaluate(() => getComputedStyle(document.querySelector('section[aria-label="Portfolio balance"]')!, '::before').animationName);
  expect(light).toBe('none');
});

for (const theme of ['official', 'light'] as const) {
  test(`the hero light stays inside its card through its drift (${theme})`, async ({ page }) => {
    for (const width of [320, 393, 480, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, 'loaded', { theme });
      for (const phase of [0, 0.5, 1]) {
        await page.addStyleTag({ content: `section[aria-label="Portfolio balance"]::before { animation-delay: ${-11 * phase}s !important; animation-play-state: paused !important; }` });
        const bounds = await page.evaluate(() => {
          const card = document.querySelector('section[aria-label="Portfolio balance"]')!;
          const style = getComputedStyle(card, '::before');
          const rect = card.getBoundingClientRect();
          const left = parseFloat(style.left); const top = parseFloat(style.top);
          const width = parseFloat(style.width); const height = parseFloat(style.height);
          const matrix = new DOMMatrix(style.transform === 'none' ? undefined : style.transform);
          // Transform origin is the box centre.
          const cx = left + width / 2; const cy = top + height / 2;
          const corners = [[left, top], [left + width, top], [left, top + height], [left + width, top + height]]
            .map(([x, y]) => matrix.transformPoint(new DOMPoint(x - cx, y - cy)))
            .map((point) => [point.x + cx, point.y + cy]);
          return { minX: Math.min(...corners.map(([x]) => x)), maxX: Math.max(...corners.map(([x]) => x)), minY: Math.min(...corners.map(([, y]) => y)), cardWidth: rect.width };
        });
        expect(bounds.minX, `left edge at ${width}px, phase ${phase}`).toBeGreaterThanOrEqual(-0.5);
        expect(bounds.maxX, `right edge at ${width}px, phase ${phase}`).toBeLessThanOrEqual(bounds.cardWidth + 0.5);
        expect(bounds.minY, `top edge at ${width}px, phase ${phase}`).toBeGreaterThanOrEqual(-46.5);
      }
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });
}

test('History paints its feed in place before the wallet loads', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 900 });
  const measure = async (stage: string) => {
    await open(page, stage, { route: '/history' });
    const result = await page.evaluate(() => ({
      title: (() => { const r = document.querySelector('.app-content h1')!.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })(),
      filters: [...document.querySelectorAll('.app-content select, .app-content input')].map((element) => { const r = element.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }),
      rows: [...document.querySelectorAll('.app-content ul li')].map((element) => { const r = element.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }),
    }));
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    return result;
  };
  const fallback = await measure('provider');
  const reads = await measure('reads');
  expect(fallback).toEqual(reads);
  expect(reads.rows).toHaveLength(5);
});
