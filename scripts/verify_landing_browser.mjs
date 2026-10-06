import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { configuredBrowserChannel } from './e2e_browser_channel.cjs';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(resolve(root, 'apps/mini-app/package.json'));
const { chromium } = require('@playwright/test');
const browserChannel = configuredBrowserChannel();
const port = process.env.LANDING_TEST_PORT || '4319';
const origin = `http://127.0.0.1:${port}`;
const output = resolve(root, 'artifacts/landing');
const CHAPTERS = ['trade', 'earn', 'borrow', 'move'];
const CHAPTER_TABS = { trade: '1', earn: '2', borrow: '2', move: '3' };
const WIDTHS = [320, 360, 393, 430, 768, 1024, 1440];

/** Text whose contrast is measured against the pixels actually painted behind it. */
const TEXT_SELECTORS = [
  '.site-header .brand span', '.site-header nav a', '.hero h1', '.hero .lede',
  '.hero .web-link', '.proof li', '.section-head h2', '.trust-copy h2', '.chapter h3', '.chapter p',
  '.chapter .text-link', '.mechanic h3', '.mechanic p', '.mechanic .text-link', '.trust-points li', '.steps h3',
  '.steps p', '.faq summary', '.finale h2', '.finale p', 'footer .brand span', '.footer-links a', '.copyright',
].join(', ');

const TARGET_SELECTORS = [
  '.site-header .brand', '.site-header nav a', '.theme-toggle', '.site-header .pill', '.menu', '.hero .actions a',
  '.text-link', '.faq summary', '.finale .actions a', 'footer .brand', '.footer-links a',
].join(', ');

const IN_BOUNDS_SELECTORS = [
  '.site-header', '.hero-copy', '.hero h1', '.hero .lede', '.hero .actions', '.hero-stage', '.proof li',
  '.section-head', '.chapter', '.chapter-phone .phone', '.mechanic', '.trust-copy', '.review-card', '.chat',
  '.steps li', '.faq-list', '.finale h2', '.finale .actions', 'footer',
].join(', ');

await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['apps/landing/serve.mjs'], {
  cwd: root,
  env: { ...process.env, PORT: port },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

/**
 * Contrast of each visible run of text against the darkest and lightest pixels
 * painted behind it (the aurora included), read from a screenshot taken with
 * the glyphs hidden. Styles change through CSSOM, which the page's CSP allows.
 */
async function measureContrast(page) {
  const targets = await page.evaluate((selectors) => {
    const parse = (value) => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const [r, g, b, a = 1] = match[1].split(',').map((part) => Number.parseFloat(part));
      return a < 0.99 ? null : [r, g, b];
    };
    const stops = (image) => [...image.matchAll(/rgba?\(([^)]+)\)/g)]
      .map((match) => match[1].split(',').map((part) => Number.parseFloat(part)).slice(0, 3));
    const runs = [];
    for (const element of document.querySelectorAll(selectors)) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim()) continue;
        const owner = node.parentElement;
        const style = getComputedStyle(owner);
        if (style.visibility === 'hidden' || owner.closest('[aria-hidden="true"]')) continue;
        let opaque = true;
        for (let ancestor = owner; ancestor; ancestor = ancestor.parentElement) if (Number(getComputedStyle(ancestor).opacity) < 0.99) opaque = false;
        if (!opaque) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = [...range.getClientRects()]
          .map((rect) => ({ x: Math.max(0, rect.left + 1), y: Math.max(0, rect.top + 1), right: Math.min(innerWidth, rect.right - 1), bottom: Math.min(innerHeight, rect.bottom - 1) }))
          .filter((rect) => rect.right - rect.x >= 2 && rect.bottom - rect.y >= 2)
          // Text covered by something else (the sticky header) is not what a reader sees there.
          .filter((rect) => {
            const top = document.elementFromPoint((rect.x + rect.right) / 2, (rect.y + rect.bottom) / 2);
            return Boolean(top && (owner === top || owner.contains(top) || top.contains(owner)));
          });
        if (!rects.length) continue;
        // Gradient text is measured by each of its colour stops.
        let colors = [];
        for (let source = owner; source && !colors.length; source = source === element ? null : source.parentElement) {
          const sourceStyle = getComputedStyle(source);
          const own = parse(sourceStyle.color);
          if (own) colors = [own];
          else if (sourceStyle.backgroundClip === 'text' || sourceStyle.webkitBackgroundClip === 'text') colors = stops(sourceStyle.backgroundImage);
        }
        const size = Number.parseFloat(style.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number.parseInt(style.fontWeight, 10) >= 700);
        runs.push({ text: node.textContent.trim().replace(/\s+/g, ' ').slice(0, 50), rects, colors, minimum: large ? 3 : 4.5 });
      }
    }
    return runs;
  }, TEXT_SELECTORS);
  // Hide every glyph, photograph what is behind them, and read those pixels.
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('body *')) {
      const style = getComputedStyle(element);
      // Gradient text paints its background through the glyphs; remove it too.
      if (style.backgroundClip === 'text' || style.webkitBackgroundClip === 'text') element.style.setProperty('background-image', 'none', 'important');
      element.style.setProperty('color', 'transparent', 'important');
      element.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
      element.style.setProperty('text-shadow', 'none', 'important');
    }
  });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const shot = await page.screenshot({ type: 'png' });
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('body *')) {
      element.style.removeProperty('background-image');
      element.style.removeProperty('color');
      element.style.removeProperty('-webkit-text-fill-color');
      element.style.removeProperty('text-shadow');
    }
  });
  return page.evaluate(async ({ png, targets }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const scale = image.naturalWidth / innerWidth;
    const luminance = ([r, g, b]) => [r, g, b].map((channel) => channel / 255)
      .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const ratio = (first, second) => (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    return targets.flatMap((target) => {
      const samples = [];
      for (const rect of target.rects) {
        const x = Math.floor(rect.x * scale);
        const y = Math.floor(rect.y * scale);
        const width = Math.max(1, Math.floor((rect.right - rect.x) * scale));
        const height = Math.max(1, Math.floor((rect.bottom - rect.y) * scale));
        const data = context.getImageData(x, y, width, height).data;
        for (let index = 0; index < data.length; index += 4 * 3) samples.push(luminance([data[index], data[index + 1], data[index + 2]]));
      }
      if (!samples.length) return [];
      samples.sort((a, b) => a - b);
      // Ignore the darkest and lightest 2% (grain and anti-aliasing).
      const darkest = samples[Math.floor(samples.length * 0.02)];
      const lightest = samples[Math.floor(samples.length * 0.98)];
      const worst = Math.min(...target.colors.map((color) => {
        const text = luminance(color);
        return Math.min(ratio(text, darkest), ratio(text, lightest));
      }));
      return target.colors.length && worst < target.minimum ? [{ text: target.text, ratio: Number(worst.toFixed(2)), minimum: target.minimum }] : [];
    });
  }, { png: shot.toString('base64'), targets });
}

let browser;
try {
  await new Promise((ready, reject) => {
    const timeout = setTimeout(() => reject(new Error('Landing server did not start')), 30_000);
    const finish = (error) => {
      clearTimeout(timeout);
      if (error) reject(error); else ready();
    };
    server.once('error', finish);
    server.once('exit', (code) => finish(new Error(`Landing server exited: ${code}`)));
    server.stdout.on('data', (chunk) => {
      if (String(chunk).includes('Landing preview:')) finish();
    });
    server.stderr.on('data', (chunk) => process.stderr.write(chunk));
  });

  browser = await chromium.launch(browserChannel ? { channel: browserChannel } : {});
  const errors = [];
  const externalRequests = [];
  const fontContentTypes = [];
  const watch = (page) => {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', (request) => {
      if (!request.url().startsWith(origin) && !request.url().startsWith('data:')) externalRequests.push(request.url());
    });
    page.on('response', (response) => {
      if (response.url().endsWith('.woff2')) fontContentTypes.push(response.headers()['content-type']);
    });
  };

  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  watch(page);
  await page.goto(origin, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.removeItem('fxaeon-theme'); localStorage.removeItem('fxaeon-motion'); });

  for (const theme of ['dark', 'light']) {
    for (const width of WIDTHS) {
      const height = width === 393 ? 852 : width < 768 ? 844 : 900;
      await page.setViewportSize({ width, height });
      const response = await page.goto(origin, { waitUntil: 'load' });
      assert.equal(response.status(), 200);
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator('h1').count(), 1, 'There should be one page heading');

      const themeToggle = page.locator('.theme-toggle');
      if (await page.locator('html').getAttribute('data-theme') !== theme) {
        await themeToggle.focus();
        await page.keyboard.press('Enter');
      }
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme, `Theme toggle did not apply ${theme}`);
      assert.equal(await themeToggle.getAttribute('aria-label'), `Switch to ${theme === 'light' ? 'dark' : 'light'} theme`);
      assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'), theme === 'dark' ? '#08070d' : '#f6f4f0');
      if (width === 320) {
        assert.equal(await page.evaluate(() => localStorage.getItem('fxaeon-theme')), theme === 'dark' ? null : 'light');
        await themeToggle.focus();
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        assert.equal(await page.evaluate(() => localStorage.getItem('fxaeon-theme')), theme);
        await page.reload({ waitUntil: 'load' });
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme, `Theme preference did not persist after reload: ${theme}`);
      }

      // Walk the page so every image decodes and the aurora settles its scroll state.
      for (const image of await page.locator('img').all()) {
        if (!await image.isVisible()) continue;
        await image.evaluate((element) => element.decode().catch(() => {}));
      }

      const state = await page.evaluate(({ inBounds, targets }) => {
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        };
        const primary = document.querySelector('.hero .actions a.pill.primary');
        primary.scrollIntoView({ block: 'center' });
        const ctaRect = primary.getBoundingClientRect();
        const hit = document.elementFromPoint(ctaRect.left + ctaRect.width / 2, ctaRect.top + ctaRect.height / 2);
        window.scrollTo(0, 0);
        const viewportWidth = document.documentElement.clientWidth;
        return {
          width: viewportWidth,
          contentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
          heroCtaHref: primary.getAttribute('href'),
          ctaHitTarget: hit?.closest('a')?.getAttribute('href') || null,
          outOfBounds: [...document.querySelectorAll(inBounds)].filter(visible).flatMap((element) => {
            const { left, right } = element.getBoundingClientRect();
            return left < -1 || right > viewportWidth + 1 ? [{ element: element.className || element.tagName, left: Math.round(left), right: Math.round(right) }] : [];
          }),
          undersizedTargets: [...document.querySelectorAll(targets)].filter(visible).flatMap((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width < 44 || rect.height < 44
              ? [{ text: element.textContent.trim().replace(/\s+/g, ' ').slice(0, 40), width: Math.round(rect.width), height: Math.round(rect.height) }]
              : [];
          }),
          images: [...document.images].filter(visible).map((image) => ({ src: image.currentSrc, loaded: image.complete && image.naturalWidth > 0 })),
          links: [...document.querySelectorAll('a')].map((link) => link.getAttribute('href')),
          chapterLinks: [...document.querySelectorAll('.chapter .text-link')].map((link) => link.getAttribute('href')),
          revealHidden: [...document.querySelectorAll('[data-reveal]:not([data-shown])')].length,
          phones: [...document.querySelectorAll('.chapter-phone')].map((holder) => ({
            chapter: holder.closest('.chapter').dataset.chapter,
            screens: [...holder.querySelectorAll('.screen')].map((screen) => screen.dataset.for),
            tab: holder.querySelector('.app-tabbar')?.getAttribute('data-tab'),
          })),
          stageShown: visible(document.querySelector('.chapter-stage')),
        };
      }, { inBounds: IN_BOUNDS_SELECTORS, targets: TARGET_SELECTORS });

      assert.ok(state.contentWidth <= state.width + 1, `Horizontal overflow at ${width}px (${theme}): scroll width ${state.contentWidth}`);
      assert.deepEqual(state.outOfBounds, [], `Visible content clipped at ${width}px (${theme})`);
      assert.equal(state.heroCtaHref, 'https://t.me/FxAeonBot', 'Telegram should remain the primary hero action');
      assert.equal(state.ctaHitTarget, 'https://t.me/FxAeonBot', `Primary Telegram CTA is blocked at ${width}px`);
      assert.equal(await page.locator('.hero .web-link[href="https://fxaeon.com/"]').count(), 1, 'Web app should remain the secondary hero action');
      assert.deepEqual(state.undersizedTargets, [], `Interactive targets smaller than 44px at ${width}px`);
      assert.ok(state.images.every((image) => image.loaded), `Missing visible image at ${width}px: ${JSON.stringify(state.images.filter((image) => !image.loaded))}`);
      assert.deepEqual(state.chapterLinks, CHAPTERS.map((route) => `https://fxaeon.com/${route}`));
      assert.equal(state.revealHidden, 0, 'Reduced motion must show every section in place');
      if (width < 960) {
        assert.equal(state.stageShown, false, 'Narrow screens stack a phone in each chapter instead of pinning one');
        assert.deepEqual(state.phones, CHAPTERS.map((chapter) => ({ chapter, screens: [chapter], tab: CHAPTER_TABS[chapter] })));
      } else {
        assert.equal(state.stageShown, true, 'Wide screens pin one phone beside the chapters');
      }
      for (const href of state.links) {
        assert.ok(href, 'An anchor is missing its destination');
        if (href.startsWith('/') || href.startsWith('#')) assert.ok(href === '/' || href.startsWith('#'), `Product link remained relative: ${href}`);
        if (href.startsWith('#')) assert.equal(await page.locator(href).count(), 1, `Broken fragment target: ${href}`);
      }

      // Contrast over the real backdrop, section by section, at two sizes.
      if (width === 393 || width === 1440) {
        const failures = [];
        const stops = ['.hero', '.proof', '#moves', '.chapter[data-chapter="earn"]', '#protocol', '.mechanics', '.trust', '#telegram', '#faq', '.finale', 'footer'];
        for (const selector of stops) {
          await page.locator(selector).first().scrollIntoViewIfNeeded();
          await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
          failures.push(...await measureContrast(page));
        }
        const unique = [...new Map(failures.map((failure) => [failure.text, failure])).values()];
        assert.deepEqual(unique, [], `Insufficient text contrast at ${width}px (${theme})`);
        await page.evaluate(() => window.scrollTo(0, 0));
      }

      const menu = page.locator('button.menu');
      if (await menu.isVisible()) {
        await menu.focus();
        await page.keyboard.press('Enter');
        assert.equal(await menu.getAttribute('aria-expanded'), 'true');
        assert.equal(await menu.getAttribute('aria-label'), 'Close menu');
        assert.equal(await page.locator('.site-header nav a').first().evaluate((element) => element === document.activeElement), true, 'Opening the menu should move focus into navigation');
        await page.keyboard.press('Escape');
        assert.equal(await menu.getAttribute('aria-expanded'), 'false');
        assert.equal(await menu.getAttribute('aria-label'), 'Open menu');
        assert.equal(await menu.evaluate((element) => element === document.activeElement), true, 'Closing the menu should return focus to its trigger');
      }
      assert.equal(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length), 0, `Reduced motion must not animate at ${width}px`);
    }
  }
  await context.close();

  // With motion welcome: arrivals settle promptly and loops stay ambient.
  const motionContext = await browser.newContext({ reducedMotion: 'no-preference', viewport: { width: 1440, height: 900 } });
  const motionPage = await motionContext.newPage();
  watch(motionPage);
  await motionPage.goto(origin, { waitUntil: 'load' });
  const timings = await motionPage.evaluate(() => document.getAnimations().map((animation) => {
    const timing = animation.effect.getComputedTiming();
    const target = animation.effect.target;
    return { name: animation.animationName ?? '', iterations: timing.iterations, duration: Number(timing.duration), delay: timing.delay, ambient: Boolean(target?.closest?.('[data-ambient]')) };
  }));
  assert.ok(timings.length > 0, 'The hero should arrive with motion');
  for (const timing of timings) {
    if (timing.iterations === Infinity) assert.ok(timing.ambient, `Looping animation outside an ambient region: ${JSON.stringify(timing)}`);
    else assert.ok(timing.delay + timing.duration * timing.iterations <= 3600, `Arrival motion must settle promptly: ${JSON.stringify(timing)}`);
  }

  // Chapters: the pinned phone follows the chapter at the middle of the screen.
  for (const chapter of CHAPTERS) {
    await motionPage.locator(`.chapter[data-chapter="${chapter}"]`).evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await motionPage.waitForFunction((name) => document.querySelector(`.chapter[data-chapter="${name}"]`)?.hasAttribute('data-active')
      && document.querySelector('.chapter-stage .phone')?.dataset.screen === name, chapter);
    const shown = await motionPage.evaluate((name) => ({
      tab: document.querySelector('.chapter-stage .app-tabbar').getAttribute('data-tab'),
      active: document.querySelector(`.chapter-stage .screen[data-for="${name}"]`).dataset.state,
      chapterActive: document.querySelector(`.chapter[data-chapter="${name}"]`).hasAttribute('data-active'),
    }), chapter);
    assert.deepEqual(shown, { tab: CHAPTER_TABS[chapter], active: 'active', chapterActive: true }, `Chapter ${chapter} should drive the phone`);
  }

  // Headlines light word by word as they are read, without changing their text.
  const headline = motionPage.locator('#protocol-title');
  assert.equal(await headline.evaluate((element) => element.textContent), 'Mechanics that work for you, stated plainly.');
  await headline.evaluate((element) => element.scrollIntoView({ block: 'end' }));
  await motionPage.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const unlit = await headline.evaluate((element) => element.querySelectorAll('.w:not([data-lit])').length);
  assert.ok(unlit > 0, 'A headline entering at the bottom of the screen should still be dim');
  await headline.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await motionPage.waitForFunction(() => document.querySelectorAll('#protocol-title .w:not([data-lit])').length === 0);
  assert.equal(await headline.evaluate((element) => element.textContent), 'Mechanics that work for you, stated plainly.');
  await motionContext.close();

  for (const theme of ['dark', 'light']) {
    for (const width of [393, 1440]) {
      const capture = await browser.newPage({ reducedMotion: 'reduce', viewport: { width, height: width === 393 ? 852 : 900 } });
      watch(capture);
      await capture.addInitScript((value) => localStorage.setItem('fxaeon-theme', value), theme);
      await capture.goto(origin, { waitUntil: 'load' });
      await capture.evaluate(() => document.fonts.ready);
      await capture.waitForTimeout(300);
      assert.equal(await capture.locator('html').getAttribute('data-theme'), theme, `Capture theme should be ${theme}`);
      await capture.screenshot({ path: resolve(output, `landing-${theme}-${width}.png`), fullPage: true });
      await capture.close();
    }
  }

  const shortPage = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 1536, height: 647 } });
  watch(shortPage);
  await shortPage.goto(origin, { waitUntil: 'load' });
  const [header, title, launch] = await Promise.all([
    shortPage.locator('.site-header').boundingBox(),
    shortPage.locator('.hero h1').boundingBox(),
    shortPage.locator('.hero .actions a.pill.primary').boundingBox(),
  ]);
  assert.ok(header && title && launch, 'Short desktop header, title, and action must be measurable');
  assert.ok(title.y >= header.y + header.height, 'Hero heading must follow the header at 1536x647');
  assert.ok(launch.y + launch.height <= 647, 'Primary Telegram action should fit a short desktop viewport');
  await shortPage.close();

  assert.deepEqual(errors, [], 'Landing threw browser errors');
  assert.deepEqual(externalRequests, [], 'Landing loaded unneeded external services');
  assert.deepEqual([...new Set(fontContentTypes)], ['font/woff2'], 'Self-hosted Inter font must be served with its font MIME type');

  console.log(`Landing browser checks passed: ${WIDTHS.length * 2} theme/viewport states, contrast over the painted backdrop, visible-content bounds, 44px targets, example semantics, stacked and pinned chapters, menu/theme keyboard and persistence, reduced motion, and zero external requests.`);
} finally {
  await browser?.close();
  server.kill();
}
