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
const WIDTHS = [320, 360, 390, 393, 430, 768, 1024, 1440];
const TELEGRAM = 'https://t.me/FxAeonBot';
const WEB = 'https://fxaeon.com/';
/** Section buttons in page order: the four chapters, the pool scene, and the bridge. */
const SECTION_ROUTES = [...CHAPTERS, 'earn', 'move'];
/**
 * A phone browser's own bars cover part of its screen. On a 375×812 iPhone,
 * Safari's status, address, and tab bars leave 629 px (its innerHeight), and
 * Telegram's in-app browser leaves about the same.
 */
const BROWSER_BARS = 183;
/** How much of the hero's phone mockup must show above those bars. */
const MOCKUP_PEEK = 40;

/** Text whose contrast is measured against the pixels actually painted behind it. */
const TEXT_SELECTORS = [
  '.site-header .brand span', '.hero h1', '.hero .lede',
  '.hero .secondary', '.telegram-qr figcaption', '.proof li', '.section-head h2', '.trust-copy h2', '.chapter h3', '.chapter p',
  '.chapter .text-link', '.scene-title', '.scene-copy > p', '.scene-copy .text-link', '.split-readout dt',
  '.split-readout b', '.split-readout small', '.split-control label', '.range-scale', '.brake-picker-label',
  '.brake-options button', '.brake-figures dt', '.brake-figures dd', '.ruler-mark span', '.ruler-scale',
  '.ruler-caption', '.scene-note', '.defenses h4', '.defenses p', '.duo-item h3', '.duo-item p',
  '.duo-item .text-link', '.sdk-lede', '.sdk-picker button', '.sdk-status', '.sdk-group h3', '.sdk-group li',
  '.sdk-key', '.trust-points li', '.steps h3',
  '.steps p', '.faq summary', '.finale h2', '.finale p', 'footer .brand span', '.footer-links a', '.copyright',
].join(', ');

const TARGET_SELECTORS = [
  '.site-header .brand', '.theme-toggle', '.site-header .pill', '.menu-toggle', '.hero .actions a',
  '.text-link', '#split-price', '.brake-options button', '.sdk-picker button', '.faq summary', '.finale .actions a',
  'footer .brand', '.footer-links a',
].join(', ');

const IN_BOUNDS_SELECTORS = [
  '.site-header', '.hero-copy', '.hero h1', '.hero .lede', '.hero .actions', '.telegram-qr', '.hero-stage', '.proof li', '.route-links',
  '.section-head', '.chapter', '.chapter-phone .phone', '.scene', '.scene-copy', '.scene-art', '.vessel',
  '.split-readout', '.split-control', '.brake-options', '.brake-figures', '.ruler', '.ruler-mark span',
  '.peg-chart', '.defenses li', '.flow', '.duo-item', '.sdk-copy', '.sdk-picker', '.sdk-group li',
  '.trust-copy', '.review-card', '.chat', '.steps li', '.faq-list', '.finale h2', '.finale .actions', 'footer',
].join(', ');

/** The open menu: its text over the panel, and what a visitor can reach in it. */
const MENU_TEXT_SELECTORS = [
  '.menu-bar .brand span', '.menu-row .menu-text', '.menu-sublist a', '.menu-kicker', '.menu-qr figcaption',
  '.menu-card .text-link', '.menu-chip', '.menu-foot',
].join(', ');
const MENU_WIDTHS = [320, 390, 1280];
const MENU_ROWS = [
  { text: 'Features', href: null }, { text: 'f(x) Protocol', href: '#protocol' }, { text: 'Telegram', href: '#telegram' },
  { text: 'FAQ', href: '#faq' }, { text: 'Docs', href: 'https://fxaeon.com/docs' }, { text: 'Source code', href: 'https://github.com/fxaeon/FxAeon' },
];
const MENU_CHIPS = [TELEGRAM, 'https://github.com/fxaeon/FxAeon', 'https://fxaeon.com/docs'];

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
async function measureContrast(page, textSelectors = TEXT_SELECTORS) {
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
  }, textSelectors);
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

/**
 * Installed before the page loads: records which hero actions, and whether the
 * QR code, the first frame shows. Only the web font may still change later.
 */
function firstFrameProbe() {
  document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(() => {
    const shown = (element) => Boolean(element) && getComputedStyle(element).display !== 'none';
    window.__firstFrame = {
      hero: [...document.querySelectorAll('.hero .actions a')].filter(shown).map((element) => element.getAttribute('href')),
      qr: shown(document.querySelector('.telegram-qr')),
    };
  }));
}

/** The device-dependent parts of the page as a visitor sees them. */
function deviceState() {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).display !== 'none';
  };
  const hrefs = (selector) => [...document.querySelectorAll(selector)].filter(visible).map((element) => element.getAttribute('href'));
  const qr = document.querySelector('.telegram-qr img');
  return {
    pointer: matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine',
    header: hrefs('.site-header .pill'),
    hero: hrefs('.hero .actions a'),
    firstFrame: window.__firstFrame,
    qr: visible(qr) ? { width: Math.round(qr.getBoundingClientRect().width), loaded: qr.complete && qr.naturalWidth > 0 } : null,
    sections: hrefs('.route-links a'),
    finale: hrefs('.finale .actions a'),
    actionsBottom: document.querySelector('.hero .actions').getBoundingClientRect().bottom,
    mockupTop: document.querySelector('.hero-stage .phone').getBoundingClientRect().top,
  };
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

      const themeToggle = page.locator('.site-header .theme-toggle');
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
        const primaries = [...document.querySelectorAll('.hero .actions a.pill.primary')].filter(visible);
        const [primary] = primaries;
        primary.scrollIntoView({ block: 'center' });
        const ctaRect = primary.getBoundingClientRect();
        const hit = document.elementFromPoint(ctaRect.left + ctaRect.width / 2, ctaRect.top + ctaRect.height / 2);
        window.scrollTo(0, 0);
        const viewportWidth = document.documentElement.clientWidth;
        return {
          width: viewportWidth,
          contentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
          heroPrimaries: primaries.map((element) => element.getAttribute('href')),
          heroSecondaries: [...document.querySelectorAll('.hero .actions a.secondary')].filter(visible).map((element) => element.getAttribute('href')),
          heroQr: [...document.querySelectorAll('.telegram-qr')].filter(visible).length,
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
          chapterLinks: [...document.querySelectorAll('.chapter .text-link')].filter(visible).map((link) => link.getAttribute('href')),
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
      // This context has a mouse: from 861px it is a desktop and leads with the web app.
      const desktop = width >= 861;
      assert.deepEqual(state.heroPrimaries, [desktop ? WEB : TELEGRAM], `One primary hero action at ${width}px`);
      assert.deepEqual(state.heroSecondaries, [desktop ? TELEGRAM : WEB], `One secondary hero action at ${width}px`);
      assert.equal(state.ctaHitTarget, desktop ? WEB : TELEGRAM, `Primary hero action is blocked at ${width}px`);
      assert.equal(state.heroQr, desktop ? 1 : 0, `The QR code shows only on a wide screen with a mouse (${width}px)`);
      assert.deepEqual(state.undersizedTargets, [], `Interactive targets smaller than 44px at ${width}px`);
      assert.ok(state.images.every((image) => image.loaded), `Missing visible image at ${width}px: ${JSON.stringify(state.images.filter((image) => !image.loaded))}`);
      assert.deepEqual(state.chapterLinks, CHAPTERS.flatMap((route) => desktop ? [`${WEB}${route}`] : [`${TELEGRAM}?startapp=${route}`, `${WEB}${route}`]));
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
        const stops = ['.hero', '.proof', '#moves', '.chapter[data-chapter="earn"]', '#protocol', '.scene-split', '.split-control',
          '.scene-brake', '.ruler', '.scene-peg', '.defenses', '.scene-pool', '.duo', '#sdk', '.sdk-group:nth-child(3)', '.sdk-key',
          '.trust', '#telegram', '#faq', '.finale', 'footer'];
        for (const selector of stops) {
          await page.locator(selector).first().scrollIntoViewIfNeeded();
          await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
          failures.push(...await measureContrast(page));
        }
        const unique = [...new Map(failures.map((failure) => [failure.text, failure])).values()];
        assert.deepEqual(unique, [], `Insufficient text contrast at ${width}px (${theme})`);
        await page.evaluate(() => window.scrollTo(0, 0));
      }

      // The header leads to the menu at every width; its links live in the menu, which stays closed until asked.
      assert.deepEqual(await page.evaluate(() => ({
        nav: document.querySelectorAll('.site-header nav').length,
        menu: getComputedStyle(document.querySelector('.site-header .menu-toggle')).display !== 'none',
        open: document.getElementById('site-menu').open,
      })), { nav: 0, menu: true, open: false }, `Header at ${width}px`);
      assert.equal(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length), 0, `Reduced motion must not animate at ${width}px`);
    }
  }
  await context.close();

  // The menu: a modal dialog over the whole page, at phone and desktop widths in both themes.
  for (const theme of ['dark', 'light']) {
    for (const width of MENU_WIDTHS) {
      const height = width < 768 ? 844 : 800;
      const label = `${width}px (${theme})`;
      const desktop = width >= 861;
      const menuPage = await browser.newPage({ reducedMotion: 'reduce', viewport: { width, height } });
      watch(menuPage);
      await menuPage.addInitScript((value) => localStorage.setItem('fxaeon-theme', value), theme);
      await menuPage.goto(origin, { waitUntil: 'load' });
      await menuPage.evaluate(() => document.fonts.ready);
      assert.equal(await menuPage.locator('html').getAttribute('data-theme'), theme);
      const toggle = menuPage.locator('.site-header .menu-toggle');
      const isOpen = () => document.getElementById('site-menu').open;
      // The dialog reports closed first; its close event then unlocks the page.
      const isClosed = () => !document.getElementById('site-menu').open && !document.documentElement.hasAttribute('data-menu-open');
      const settled = () => document.getAnimations().every((animation) => animation.playState !== 'running');

      // Closed: the brand, the theme toggle, the device's action where it fits, and the Menu pill.
      const controls = await menuPage.evaluate(() => [...document.querySelectorAll('.site-header a, .site-header button')]
        .filter((element) => element.getClientRects().length && getComputedStyle(element).display !== 'none')
        .map((element) => element.getAttribute('aria-label') || element.textContent.trim().replace(/\s+/g, ' ')));
      assert.deepEqual(controls, ['FxAeon home', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
        ...(width >= 560 ? [desktop ? 'Open web app →' : 'Open in Telegram ↗'] : []), 'Open menu'], `Header controls at ${label}`);
      assert.deepEqual(await toggle.evaluate((element) => [element.getAttribute('aria-expanded'), element.getAttribute('aria-controls')]), ['false', 'site-menu']);
      // The Close pill's autofocus belongs to the open menu; on load nothing takes focus.
      assert.equal(await menuPage.evaluate(() => document.activeElement === document.body), true, 'Nothing takes focus on load');
      await menuPage.screenshot({ path: resolve(output, `menu-closed-${theme}-${width}.png`) });
      const pill = await toggle.boundingBox();

      // Opened from the keyboard: focus moves to the Close pill, drawn exactly where the Menu pill was,
      // and the page beneath stops scrolling without shifting.
      await toggle.focus();
      await menuPage.keyboard.press('Enter');
      await menuPage.waitForFunction(isOpen);
      await menuPage.waitForFunction(settled);
      if (desktop) await menuPage.locator('.menu-qr img').evaluate((image) => image.decode());
      const open = await menuPage.evaluate(() => {
        const menu = document.getElementById('site-menu');
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        };
        const box = (element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return { x, y, width, height };
        };
        const viewport = document.documentElement.clientWidth;
        const reachable = [...menu.querySelectorAll('a, button')].filter(visible);
        const qr = menu.querySelector('.menu-qr img');
        return {
          expanded: document.querySelector('.site-header .menu-toggle').getAttribute('aria-expanded'),
          focused: document.activeElement?.getAttribute('aria-label'),
          close: box(menu.querySelector('.menu-close')),
          menuPill: box(document.querySelector('.site-header .menu-toggle')),
          locked: getComputedStyle(document.documentElement).overflow,
          rows: [...menu.querySelectorAll('.menu-row')].map((row) => ({ text: row.textContent.trim(), href: row.getAttribute('href') })),
          lines: [...[...menu.querySelectorAll('.menu-list > li')].map((item) => getComputedStyle(item, '::before')), getComputedStyle(menu.querySelector('.menu-list'), '::after')]
            .map((line) => line.height === '1px' && line.backgroundColor !== 'rgba(0, 0, 0, 0)'),
          wrapped: [...menu.querySelectorAll('.menu-text')].filter((text) => text.getBoundingClientRect().height > Number.parseFloat(getComputedStyle(text).fontSize) * 1.5).map((text) => text.textContent),
          overflow: [document.documentElement, menu, menu.querySelector('.menu-body')].map((element) => element.scrollWidth - element.clientWidth),
          outOfBounds: [...reachable, ...menu.querySelectorAll('.menu-label, .menu-card, .menu-foot')].filter(visible).flatMap((element) => {
            const { left, right } = element.getBoundingClientRect();
            return left < -1 || right > viewport + 1 ? [`${element.className} ${Math.round(left)}–${Math.round(right)}`] : [];
          }),
          undersized: reachable.flatMap((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width < 44 || rect.height < 44 ? [`${element.textContent.trim()} ${Math.round(rect.width)}×${Math.round(rect.height)}`] : [];
          }),
          side: [...menu.querySelectorAll('.menu-side a')].filter(visible).map((link) => link.getAttribute('href')),
          qr: visible(qr) ? qr.complete && qr.naturalWidth > 0 : null,
        };
      });
      assert.equal(open.expanded, 'true');
      assert.equal(open.focused, 'Close menu', `Opening the menu moves focus to its Close pill at ${label}`);
      for (const key of ['x', 'y', 'width', 'height']) {
        assert.ok(Math.abs(open.close[key] - pill[key]) <= 1, `The Close pill opens where the Menu pill was at ${label}: ${JSON.stringify({ pill, close: open.close })}`);
        assert.ok(Math.abs(open.menuPill[key] - pill[key]) <= 0.5, `The page shifted under the open menu at ${label}`);
      }
      assert.equal(open.locked, 'hidden', 'The page stops scrolling under the open menu');
      assert.deepEqual(open.rows, MENU_ROWS, `Menu rows at ${label}`);
      assert.deepEqual(open.lines, Array(MENU_ROWS.length + 1).fill(true), 'Hairlines rule the list above, between, and below its rows');
      assert.deepEqual(open.wrapped, [], `A menu label wraps at ${label}`);
      assert.deepEqual(open.overflow, [0, 0, 0], `Horizontal overflow in the open menu at ${label}`);
      assert.deepEqual(open.outOfBounds, [], `Menu content clipped at ${label}`);
      assert.deepEqual(open.undersized, [], `Menu targets smaller than 44px at ${label}`);
      assert.deepEqual(open.side, [desktop ? WEB : TELEGRAM, ...MENU_CHIPS], `Ways in at ${label}`);
      assert.equal(open.qr, desktop ? true : null, `The menu shows the QR code only on a wide screen with a mouse (${label})`);
      const scrolled = await menuPage.evaluate(() => window.scrollY);
      await menuPage.mouse.move(width / 2, height - 40);
      await menuPage.mouse.wheel(0, 900);
      await menuPage.waitForTimeout(250);
      assert.equal(await menuPage.evaluate(() => window.scrollY), scrolled, 'The page does not scroll beneath the open menu');
      if (width !== 320) {
        const failures = await measureContrast(menuPage, MENU_TEXT_SELECTORS);
        assert.deepEqual([...new Map(failures.map((failure) => [failure.text, failure])).values()], [], `Insufficient menu text contrast at ${label}`);
      }
      await menuPage.locator('.menu-body').evaluate((element) => element.scrollTo(0, 0));
      await menuPage.screenshot({ path: resolve(output, `menu-open-${theme}-${width}.png`) });

      // Features unfolds its links inside the ruled list: the overview, then each screen in the app for this device.
      const features = menuPage.locator('.menu-row[aria-controls="menu-features"]');
      await features.focus();
      await menuPage.keyboard.press('Enter');
      assert.equal(await features.getAttribute('aria-expanded'), 'true');
      const unfolded = await menuPage.evaluate(() => {
        const links = [...document.querySelectorAll('#menu-features a')].filter((link) => link.getClientRects().length && getComputedStyle(link).visibility === 'visible');
        const next = document.querySelector('.menu-list > li:nth-child(2)').getBoundingClientRect().top;
        return {
          links: links.map((link) => link.getAttribute('href')),
          short: links.filter((link) => link.getBoundingClientRect().height < 44).length,
          inside: links.every((link) => link.getBoundingClientRect().bottom <= next),
        };
      });
      assert.deepEqual(unfolded, {
        links: ['#moves', ...CHAPTERS.map((route) => (desktop ? `${WEB}${route}` : `${TELEGRAM}?startapp=${route}`))],
        short: 0,
        inside: true,
      }, `Features links at ${label}`);
      await menuPage.screenshot({ path: resolve(output, `menu-features-${theme}-${width}.png`) });
      await menuPage.keyboard.press('Enter');
      assert.equal(await features.getAttribute('aria-expanded'), 'false');
      assert.equal(await menuPage.locator('#menu-features a').evaluateAll((links) => links.filter((link) => getComputedStyle(link).visibility !== 'hidden').length), 0, 'A folded group takes its links out of reach');

      // Focus stays in the menu: Tab and Shift+Tab cycle through it, passing only through the browser's own
      // controls (the body, here) as they wrap, never onto the page beneath.
      const stops = await menuPage.evaluate(() => [...document.getElementById('site-menu').querySelectorAll('a[href], button')]
        .filter((element) => element.getClientRects().length && getComputedStyle(element).visibility === 'visible').length);
      const escaped = [];
      for (const key of [...Array(stops + 3).fill('Tab'), ...Array(4).fill('Shift+Tab')]) {
        await menuPage.keyboard.press(key);
        const where = await menuPage.evaluate(() => {
          const active = document.activeElement;
          return active === document.body || document.getElementById('site-menu').contains(active) ? null : active.outerHTML.slice(0, 80);
        });
        if (where) escaped.push(where);
      }
      assert.deepEqual(escaped, [], `Focus left the open menu at ${label}`);
      assert.equal(await menuPage.evaluate(() => document.getElementById('site-menu').contains(document.activeElement)), true);

      // Escape closes it and focus returns to the Menu pill.
      await menuPage.keyboard.press('Escape');
      await menuPage.waitForFunction(isClosed);
      assert.deepEqual(await menuPage.evaluate(() => ({
        expanded: document.querySelector('.site-header .menu-toggle').getAttribute('aria-expanded'),
        focused: document.activeElement === document.querySelector('.site-header .menu-toggle'),
        locked: getComputedStyle(document.documentElement).overflow,
      })), { expanded: 'false', focused: true, locked: 'visible' }, `Escape at ${label}`);

      // A section closes the menu, then follows the link to just below the header.
      for (const [selector, hash] of [['.menu-row[href="#faq"]', '#faq'], ...(width === 390 ? [['#menu-features a[href="#moves"]', '#moves']] : [])]) {
        await toggle.click();
        await menuPage.waitForFunction(isOpen);
        if (hash === '#moves') await features.click();
        await menuPage.locator(selector).click();
        await menuPage.waitForFunction((target) => !document.getElementById('site-menu').open && window.location.hash === target, hash);
        const landed = await menuPage.evaluate((target) => ({
          top: document.querySelector(target).getBoundingClientRect().top,
          offset: Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop),
          expanded: document.querySelector('.site-header .menu-toggle').getAttribute('aria-expanded'),
        }), hash);
        assert.ok(Math.abs(landed.top - landed.offset) <= 2, `${hash} should land at the header offset at ${label}: ${JSON.stringify(landed)}`);
        assert.equal(landed.expanded, 'false');
      }

      // The Close pill closes it too, and returns focus to the Menu pill.
      await toggle.click();
      await menuPage.waitForFunction(isOpen);
      await menuPage.locator('.menu-close').click();
      await menuPage.waitForFunction(isClosed);
      assert.equal(await toggle.evaluate((element) => element === document.activeElement), true, `The Close pill returns focus at ${label}`);
      await menuPage.waitForFunction(settled);
      await menuPage.close();
    }
  }

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
  assert.equal(await headline.evaluate((element) => element.textContent), 'How f(x) Protocol works.');
  await headline.evaluate((element) => element.scrollIntoView({ block: 'end' }));
  await motionPage.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const unlit = await headline.evaluate((element) => element.querySelectorAll('.w:not([data-lit])').length);
  assert.ok(unlit > 0, 'A headline entering at the bottom of the screen should still be dim');
  await headline.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await motionPage.waitForFunction(() => document.querySelectorAll('#protocol-title .w:not([data-lit])').length === 0);
  assert.equal(await headline.evaluate((element) => element.textContent), 'How f(x) Protocol works.');

  // The split: the keyboard moves the price; fxUSD holds while the share takes the move.
  const split = motionPage.locator('#split-price');
  await split.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await split.focus();
  for (let step = 0; step < 10; step += 1) await motionPage.keyboard.press('ArrowLeft');
  assert.deepEqual(await motionPage.evaluate(() => ({
    share: document.querySelector('[data-split="share"]').textContent,
    change: document.querySelector('[data-split="change"]').textContent,
    collateral: document.querySelector('[data-split="collateral"]').textContent,
    leverage: document.querySelector('[data-split="leverage"]').textContent,
    text: document.querySelector('#split-price').getAttribute('aria-valuetext'),
  })), {
    share: '$2,100', change: '−30.0%', collateral: '$8,100', leverage: '3.9×',
    text: 'ETH down 10%, at $2,700. Your share $2,100, minus 30.0%. fxUSD stays 6,000.',
  }, 'A 10% fall moves a 3× share by 30%');

  // The brake: each leverage shows the docs' distances to the two lines.
  await motionPage.locator('.brake-options button[data-leverage="5"]').click();
  assert.deepEqual(await motionPage.evaluate(() => ({
    rebalance: document.querySelector('[data-brake="rebalance"]').textContent,
    liquidation: document.querySelector('[data-brake="liquidation"]').textContent,
    pressed: [...document.querySelectorAll('.brake-options button[aria-pressed="true"]')].map((button) => button.textContent),
  })), { rebalance: '9.09', liquidation: '15.79', pressed: ['5×'] });

  // What runs when you tap: Move lights exactly its two bridge methods.
  await motionPage.locator('.sdk-picker button[data-screen="move"]').click();
  assert.deepEqual(await motionPage.evaluate(() => [...document.querySelectorAll('.sdk-board li[data-on]')].map((row) => row.dataset.method)),
    ['getBridgeQuote', 'buildBridgeTx']);
  assert.match(await motionPage.locator('[data-sdk-status]').textContent(), /^Move uses 2 of 15 methods: buildBridgeTx prepares its transactions; getBridgeQuote reads the state it shows\.$/);

  // The peg bead runs only while its chart is on screen and motion is welcome.
  await motionPage.locator('.peg-chart').evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await motionPage.waitForFunction(() => document.querySelector('.peg-chart')?.hasAttribute('data-moving'), null, { timeout: 6_000 });

  // The menu with motion: a clip-path circle grows out of the Menu pill, then every label, line, and the
  // side column arrives; Escape shrinks it back into the pill and focus returns there.
  await motionPage.locator('.site-header .menu-toggle').click();
  assert.deepEqual(await motionPage.evaluate(() => document.getElementById('site-menu').getAnimations()
    .map((animation) => Object.keys(animation.effect.getKeyframes()[0]).filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key)))), [['clipPath']]);
  await motionPage.waitForFunction(() => document.getElementById('site-menu').getAnimations({ subtree: true }).length === 0, null, { timeout: 4_000 });
  assert.deepEqual(await motionPage.evaluate(() => {
    const menu = document.getElementById('site-menu');
    return {
      clip: getComputedStyle(menu).clipPath,
      labels: [...menu.querySelectorAll('.menu-text')].every((text) => getComputedStyle(text).transform === 'none'),
      lines: [...menu.querySelectorAll('.menu-list > li')].every((item) => getComputedStyle(item, '::before').transform === 'none')
        && getComputedStyle(menu.querySelector('.menu-list'), '::after').transform === 'none',
      side: getComputedStyle(menu.querySelector('.menu-side')).opacity,
      foot: getComputedStyle(menu.querySelector('.menu-foot')).opacity,
      close: getComputedStyle(menu.querySelector('.menu-close .menu-words span:last-child')).transform,
    };
  }), { clip: 'none', labels: true, lines: true, side: '1', foot: '1', close: 'none' }, 'Everything in the menu arrives');
  await motionPage.keyboard.press('Escape');
  await motionPage.waitForFunction(() => !document.getElementById('site-menu').open && !document.documentElement.hasAttribute('data-menu-open'), null, { timeout: 4_000 });
  assert.equal(await motionPage.evaluate(() => document.activeElement === document.querySelector('.site-header .menu-toggle')), true, 'Escape returns focus to the Menu pill');
  await motionContext.close();

  // Without script the page is complete: no inert controls, every SDK method readable.
  const staticContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const staticPage = await staticContext.newPage();
  watch(staticPage);
  await staticPage.goto(origin, { waitUntil: 'load' });
  assert.deepEqual(await staticPage.evaluate(() => ['.split-control', '.brake-picker', '.sdk-picker', '.sdk-status']
    .map((selector) => getComputedStyle(document.querySelector(selector)).display)), ['none', 'none', 'none', 'none']);
  assert.equal(await staticPage.locator('.sdk-group li').count(), 15);
  // The device-aware actions are CSS alone, so they need no script either.
  assert.deepEqual(await staticPage.evaluate(deviceState).then(({ hero }) => hero), [TELEGRAM, WEB]);
  // The menu needs script, so without it there is no Menu pill to press.
  assert.equal(await staticPage.evaluate(() => getComputedStyle(document.querySelector('.menu-toggle')).display), 'none');
  await staticContext.close();

  // Device-aware actions, as phones, a touch tablet, and a desktop see them.
  const openAs = async (options, waitForQr = false) => {
    const deviceContext = await browser.newContext({ reducedMotion: 'reduce', ...options });
    const devicePage = await deviceContext.newPage();
    watch(devicePage);
    const requested = [];
    devicePage.on('request', (request) => requested.push(new URL(request.url()).pathname));
    await devicePage.addInitScript(firstFrameProbe);
    await devicePage.goto(origin, { waitUntil: 'load' });
    await devicePage.evaluate(() => document.fonts.ready);
    if (waitForQr) await devicePage.locator('.telegram-qr img').evaluate((image) => image.decode());
    const shown = await devicePage.evaluate(deviceState);
    await deviceContext.close();
    return { ...shown, qrRequested: requested.some((path) => path.endsWith('/assets/telegram-qr.svg')) };
  };

  // Phones lead with Telegram, open each section's screen in the Mini App, and
  // never show or download the QR code. The smaller hero leaves the mockup's
  // top edge on the first screen, below the browser's own bars.
  for (const [width, height] of [[360, 740], [375, 812], [390, 844], [393, 852], [430, 850]]) {
    const shown = await openAs({ viewport: { width, height }, isMobile: true, hasTouch: true });
    const firstScreen = height - BROWSER_BARS;
    assert.equal(shown.pointer, 'coarse');
    assert.deepEqual(shown.hero, [TELEGRAM, WEB], `Telegram leads the hero on a ${width}×${height} phone`);
    assert.deepEqual(shown.firstFrame, { hero: shown.hero, qr: false }, 'The first frame already shows the phone actions');
    assert.equal(shown.qr, null, 'Phones do not show the QR code');
    assert.equal(shown.qrRequested, false, 'Phones do not download the QR code');
    assert.deepEqual(shown.sections, SECTION_ROUTES.flatMap((route) => [`${TELEGRAM}?startapp=${route}`, `${WEB}${route}`]));
    assert.deepEqual(shown.finale, [TELEGRAM, WEB]);
    assert.ok(shown.actionsBottom <= firstScreen, `Both hero actions fit the first screen at ${width}×${height}`);
    assert.ok(shown.mockupTop + MOCKUP_PEEK <= firstScreen,
      `The phone mockup's top edge should show on the first screen at ${width}×${height}: it starts at ${Math.round(shown.mockupTop)}px of ${firstScreen}px`);
  }

  // A tablet is touch first: wide, but Telegram still leads, in the header too.
  const tablet = await openAs({ viewport: { width: 1024, height: 1366 }, isMobile: true, hasTouch: true });
  assert.deepEqual({ header: tablet.header, hero: tablet.hero, firstFrame: tablet.firstFrame, qr: tablet.qr, qrRequested: tablet.qrRequested },
    { header: [TELEGRAM], hero: [TELEGRAM, WEB], firstFrame: { hero: [TELEGRAM, WEB], qr: false }, qr: null, qrRequested: false });

  // A desktop leads with the web app, shows the QR code beside "Open in Telegram",
  // and keeps the sections on the web.
  const desktop = await openAs({ viewport: { width: 1440, height: 900 } }, true);
  assert.equal(desktop.pointer, 'fine');
  assert.deepEqual(desktop.header, [WEB]);
  assert.deepEqual(desktop.hero, [WEB, TELEGRAM]);
  assert.deepEqual(desktop.firstFrame, { hero: desktop.hero, qr: true }, 'The first frame already shows the desktop actions and QR code');
  assert.deepEqual(desktop.qr, { width: 88, loaded: true });
  assert.deepEqual(desktop.sections, SECTION_ROUTES.map((route) => `${WEB}${route}`));
  assert.deepEqual(desktop.finale, [WEB, TELEGRAM]);

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
  const [header, title, launch, code] = await Promise.all([
    shortPage.locator('.site-header').boundingBox(),
    shortPage.locator('.hero h1').boundingBox(),
    shortPage.locator('.hero .actions a.pill.primary:visible').boundingBox(),
    shortPage.locator('.telegram-qr').boundingBox(),
  ]);
  assert.ok(header && title && launch && code, 'Short desktop header, title, action, and QR code must be measurable');
  assert.ok(title.y >= header.y + header.height, 'Hero heading must follow the header at 1536x647');
  assert.ok(launch.y + launch.height <= 647, 'Primary action should fit a short desktop viewport');
  assert.ok(code.y + code.height <= 647, 'The QR code should fit a short desktop viewport');
  await shortPage.close();

  assert.deepEqual(errors, [], 'Landing threw browser errors');
  assert.deepEqual(externalRequests, [], 'Landing loaded unneeded external services');
  assert.deepEqual([...new Set(fontContentTypes)], ['font/woff2'], 'Self-hosted Inter font must be served with its font MIME type');

  console.log(`Landing browser checks passed: ${WIDTHS.length * 2} theme/viewport states, contrast over the painted backdrop, visible-content bounds, 44px targets, example semantics, stacked and pinned chapters, theme keyboard and persistence, the fullscreen menu at ${MENU_WIDTHS.join('/')}px in both themes (focus trap, Escape and focus return, scroll lock, section links, contrast, no overflow) and with motion, reduced motion, device-aware actions on phones, a tablet, and a desktop, the hero fit on 360-430px phones, and zero external requests.`);
} finally {
  await browser?.close();
  server.kill();
}
