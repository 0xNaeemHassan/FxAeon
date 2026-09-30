import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(resolve(root, 'apps/mini-app/package.json'));
const { chromium } = require('@playwright/test');
const port = process.env.LANDING_TEST_PORT || '4319';
const origin = `http://127.0.0.1:${port}`;
const output = resolve(root, 'artifacts/landing');
const FEATURE_HREFS = [
  'https://fxaeon.com/trade',
  'https://fxaeon.com/earn',
  'https://fxaeon.com/borrow',
  'https://fxaeon.com/move',
];

await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['apps/landing/serve.mjs'], {
  cwd: root,
  env: { ...process.env, PORT: port },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

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

  browser = await chromium.launch();
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  const externalRequests = [];
  const fontContentTypes = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (!request.url().startsWith(origin) && !request.url().startsWith('data:')) externalRequests.push(request.url());
  });
  page.on('response', (response) => {
    if (response.url().endsWith('.woff2')) fontContentTypes.push(response.headers()['content-type']);
  });

  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.removeItem('fxaeon-theme'));
  for (const theme of ['dark', 'light']) {
    for (const width of [320, 360, 393, 430, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width === 393 ? 852 : width < 768 ? 844 : 900 });
      const response = await page.goto(origin, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200);
      await page.evaluate(() => document.fonts.ready);
      await page.locator('.hero h1').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.hero h1').count(), 1, 'There should be one page heading');

      const themeToggle = page.locator('.theme-toggle');
      if (await page.locator('html').getAttribute('data-theme') !== theme) {
        await themeToggle.focus();
        await page.keyboard.press('Enter');
      }
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme, `Theme toggle did not apply ${theme}`);
      assert.equal(await themeToggle.getAttribute('aria-pressed'), String(theme === 'light'));
      assert.equal(await themeToggle.getAttribute('aria-label'), `Switch to ${theme === 'light' ? 'dark' : 'light'} theme`);
      if (width === 320) {
        if (theme === 'dark') {
          await themeToggle.focus();
          await page.keyboard.press('Enter');
          assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
          assert.equal(await page.evaluate(() => localStorage.getItem('fxaeon-theme')), 'light');
          await themeToggle.focus();
          await page.keyboard.press('Enter');
          assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
        }
        assert.equal(await page.evaluate(() => localStorage.getItem('fxaeon-theme')), theme);
        await page.reload({ waitUntil: 'networkidle' });
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme, `Theme preference did not persist after reload: ${theme}`);
      }

      for (const image of await page.locator('img').all()) {
        if (!await image.isVisible()) continue;
        await image.scrollIntoViewIfNeeded();
        await image.evaluate((element) => element.decode());
      }
      await page.locator('.hero .actions').scrollIntoViewIfNeeded();

      const state = await page.evaluate(() => {
        const parseColor = (value) => {
          const color = value.trim();
          if (/^#[\da-f]{3}$/i.test(color)) return [...color.slice(1)].map((digit) => Number.parseInt(digit + digit, 16));
          if (/^#[\da-f]{6}$/i.test(color)) return [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16));
          const match = color.match(/rgba?\(([^)]+)\)/);
          if (!match) return null;
          const channels = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
          if (channels.length === 4 && channels[3] < 0.99) return null;
          return channels.slice(0, 3);
        };
        const luminance = (rgb) => rgb.map((channel) => channel / 255)
          .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
          .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
        const ratio = (foreground, background) => {
          const first = luminance(foreground);
          const second = luminance(background);
          return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
        };
        const gradientStops = (image) => [...image.matchAll(/rgb\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)\)/g)]
          .map((match) => match.slice(1).map(Number));
        const surfaceColorsFor = (element) => {
          for (let node = element; node && node.tagName !== 'BODY'; node = node.parentElement) {
            if (node.matches('.product-preview')) {
              const stops = gradientStops(getComputedStyle(node).backgroundImage);
              if (stops.length) return stops;
            }
            const color = parseColor(getComputedStyle(node).backgroundColor);
            if (color) return [color];
          }
          const body = parseColor(getComputedStyle(document.body).backgroundColor);
          return body ? [body] : [];
        };
        const contrastFor = (selectors) => [...document.querySelectorAll(selectors)].flatMap((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden') return [];
          const foreground = parseColor(style.color);
          const backgrounds = surfaceColorsFor(element);
          const fontSize = Number.parseFloat(style.fontSize);
          const largeText = fontSize >= 24 || (fontSize >= 18.66 && Number.parseInt(style.fontWeight, 10) >= 700);
          return [{
            text: element.textContent.trim().replace(/\s+/g, ' ').slice(0, 60),
            ratio: foreground && backgrounds.length ? Math.min(...backgrounds.map((background) => ratio(foreground, background))) : null,
            minimum: largeText ? 3 : 4.5,
          }];
        });

        const primaryCta = document.querySelector('.hero .actions a[href="https://t.me/FxAeonBot"]');
        const ctaRect = primaryCta.getBoundingClientRect();
        const hit = document.elementFromPoint(ctaRect.left + ctaRect.width / 2, ctaRect.top + ctaRect.height / 2);
        const geometrySelectors = [
          '.site-header', '.site-header .brand', '.hero-copy', '.hero h1', '.hero .lede', '.hero .actions',
          '.hero-art', '.product-preview', '.product-inner', '.feature-list',
          '.feature-list', '.feature', '.mechanics', '.mechanics-heading', '.mechanics-list article', 'footer', '.footer-links',
        ];
        const geometry = geometrySelectors.flatMap((selector) => [...document.querySelectorAll(selector)].map((element) => {
          const { left, right, width: boxWidth, height: boxHeight } = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden' || boxWidth <= 0 || boxHeight <= 0) return null;
          return { selector, left, right, viewportWidth: document.documentElement.clientWidth };
        }).filter(Boolean));
        const targetSelectors = [
          '.site-header .brand', '.site-header nav a', '.site-header .social', '.site-header .theme-toggle',
          '.site-header .pill', '.site-header .menu', '.hero .actions a', '.hero .web-link', '.feature-list > a.feature',
          '.mechanics a.text-link', 'footer .brand', '.footer-links a',
        ].join(', ');
        const undersizedTargets = [...document.querySelectorAll(targetSelectors)].flatMap((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0) return [];
          return rect.width < 44 || rect.height < 44
            ? [{ text: element.textContent.trim().replace(/\s+/g, ' ').slice(0, 60), width: rect.width, height: rect.height }]
            : [];
        });
        return {
          width: document.documentElement.clientWidth,
          contentWidth: document.documentElement.scrollWidth,
          theme: document.documentElement.dataset.theme,
          themeColor: document.querySelector('meta[name="theme-color"]')?.content,
          heading: document.querySelector('.hero h1').innerText.replace(/\s+/g, ' ').trim(),
          heroCtaHref: primaryCta.getAttribute('href'),
          heroArtOverlapsHeadline: (() => {
            const art = document.querySelector('.hero-art').getBoundingClientRect();
            const title = document.querySelector('.hero h1').getBoundingClientRect();
            return art.left < title.right && art.right > title.left && art.top < title.bottom && art.bottom > title.top;
          })(),
          ctaHitTarget: hit?.closest('a')?.getAttribute('href') || null,
          preview: (() => {
            const preview = document.querySelector('.product-preview');
            const rect = preview.getBoundingClientRect();
            return {
              visible: rect.width > 0 && rect.height > 0 && getComputedStyle(preview).visibility !== 'hidden',
              text: preview.innerText.replace(/\s+/g, ' ').trim(),
              fakeControls: preview.querySelectorAll('a, button, input, select, textarea').length,
              caption: preview.closest('figure').getAttribute('aria-label'),
              contentPainted: [...preview.querySelectorAll('.preview-header, .preview-content, .preview-summary, .preview-actions, .preview-list-title, .preview-asset, .preview-position')]
                .every((element) => {
                  const rect = element.getBoundingClientRect();
                  const style = getComputedStyle(element);
                  return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.9;
                }),
              targetsReadable: [...preview.querySelectorAll('.preview-label, .preview-summary strong, .preview-meta, .preview-list-title, .preview-asset, .preview-position')]
                .every((element) => Number.parseFloat(getComputedStyle(element).fontSize) >= 10),
            };
          })(),
          mobileArtOverlapsHeadline: innerWidth <= 520 && (() => {
            const art = document.querySelector('.hero-art').getBoundingClientRect();
            const title = document.querySelector('.hero h1').getBoundingClientRect();
            return art.left < title.right && art.right > title.left && art.top < title.bottom && art.bottom > title.top;
          })(),
          visibleImages: [...document.images].filter((image) => {
            const rect = image.getBoundingClientRect();
            const style = getComputedStyle(image);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
          }).map((image) => ({ src: image.currentSrc, loaded: image.complete && image.naturalWidth > 0 })),
          links: [...document.querySelectorAll('a')].map((link) => link.getAttribute('href')),
          featureHrefs: [...document.querySelectorAll('.feature-list > a.feature')].map((link) => link.getAttribute('href')),
          undersizedTargets,
          geometry,
          contrast: {
            header: contrastFor('.site-header .brand, .site-header nav a, .site-header .social, .site-header .pill, .hero h1, .hero .lede, .hero .micro, .hero .actions a, .hero .web-link'),
            preview: contrastFor('.preview-label, .preview-account, .preview-summary strong, .preview-meta, .preview-list-title, .asset-name, .asset-value, .preview-position'),
            product: contrastFor('.section-heading h2, .section-heading p, .feature-heading h3, .feature-body'),
            mechanics: contrastFor('.mechanics h2, .mechanic-title h3, .mechanics-list p, .mechanics .text-link'),
            footer: contrastFor('footer .brand, .footer-links a, footer p'),
          },
        };
      });

      await page.locator('footer').scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollTo({ left: 0, top: window.scrollY, behavior: 'instant' }));
      assert.ok(state.contentWidth <= state.width + 1, `Horizontal overflow at ${width}px (${theme}): scroll width ${state.contentWidth}`);
      assert.ok(state.geometry.every(({ left, right, viewportWidth }) => left >= -1 && right <= viewportWidth + 1), `Visible content clipped at ${width}px (${theme}): ${JSON.stringify(state.geometry.filter(({ left, right, viewportWidth }) => left < -1 || right > viewportWidth + 1))}`);
      assert.match(state.heading, /^Trade ETH and BTC,\s*earn with fxSAVE,\s*and borrow fxUSD\s*In Telegram\.$/, 'Hero should state the available trade, earn, and borrow actions before the Telegram destination');
      assert.equal(await page.locator('.hero .lede').innerText(), 'Powered by f(x) SDK', 'Hero should identify the integration plainly');
      assert.equal(await page.locator('#positions').count(), 1, 'Positions navigation anchor should exist exactly once');
      assert.equal(await page.locator('#product').count(), 1, 'Product section anchor should exist exactly once');
      assert.equal(state.theme, theme, `Unexpected rendered theme at ${width}px`);
      assert.equal(state.themeColor, theme === 'dark' ? '#18171d' : '#f8f7f3', `Theme metadata mismatch at ${width}px`);
      assert.equal(state.heroCtaHref, 'https://t.me/FxAeonBot', 'Telegram should remain the primary hero action');
      assert.equal(state.ctaHitTarget, 'https://t.me/FxAeonBot', `Primary Telegram CTA is blocked at ${width}px`);
      assert.equal(await page.locator('.hero .web-link[href="https://fxaeon.com/"]').count(), 1, 'Web app should remain the secondary hero action');
      assert.ok(state.preview.visible, `Illustrative portfolio preview is not visible at ${width}px`);
      assert.match(state.preview.caption, /illustrative balances/i, 'Portfolio balances must remain labeled illustrative');
      assert.match(state.preview.text, /Portfolio value/);
      assert.match(state.preview.text, /ETH/);
      assert.match(state.preview.text, /fxUSD/);
      assert.equal(state.preview.fakeControls, 0, 'Preview-only portfolio controls must not masquerade as interactive');
      assert.ok(state.preview.contentPainted, `Portfolio preview details must remain rendered at ${width}px (${theme})`);
      assert.ok(state.preview.targetsReadable, 'Portfolio preview labels should remain legible at 10px or larger');
      if (width <= 520) assert.ok(!state.mobileArtOverlapsHeadline, `Portfolio preview overlaps headline at ${width}px`);
      assert.ok(state.visibleImages.every((image) => image.loaded), `Missing visible image at ${width}px: ${JSON.stringify(state.visibleImages.filter((image) => !image.loaded))}`);
      assert.deepEqual([...new Set(state.featureHrefs)].sort(), [...FEATURE_HREFS].sort(), `Feature destinations must include Trade, Earn, Borrow, and Move at ${width}px`);
      assert.deepEqual(state.undersizedTargets, [], `Interactive targets shorter than 44px at ${width}px: ${JSON.stringify(state.undersizedTargets)}`);
      for (const [surfaceName, surfaces] of Object.entries(state.contrast)) {
        for (const surface of surfaces) {
          assert.ok(surface.ratio !== null && surface.ratio >= surface.minimum, `Insufficient ${surfaceName} text contrast at ${width}px (${theme}): ${JSON.stringify(surface)}`);
        }
      }
      for (const href of state.links) {
        assert.ok(href, 'An anchor is missing its destination');
        if (href.startsWith('/') || href.startsWith('#')) assert.ok(href === '/' || href.startsWith('#'), `Product link remained relative: ${href}`);
        if (href.startsWith('#')) assert.equal(await page.locator(href).count(), 1, `Broken fragment target: ${href}`);
      }

      const menu = page.locator('button.menu');
      if (await menu.isVisible()) {
        await menu.focus();
        await page.keyboard.press('Enter');
        assert.equal(await menu.getAttribute('aria-expanded'), 'true');
        assert.equal(await menu.getAttribute('aria-label'), 'Close menu');
        assert.equal(await page.locator('.site-header nav a').first().evaluate((element) => element === document.activeElement), true, 'Opening the menu should move focus into navigation');
        const menuContrast = await page.locator('.site-header nav a').first().evaluate((element) => {
          const foreground = getComputedStyle(element).color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
          const background = getComputedStyle(element.parentElement).backgroundColor.match(/[\d.]+/g)?.slice(0, 3).map(Number);
          if (!foreground || !background) return null;
          const lum = (rgb) => rgb.map((channel) => channel / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
          const first = lum(foreground); const second = lum(background);
          return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
        });
        assert.ok(menuContrast !== null && menuContrast >= 4.5, `Open mobile menu contrast is too low: ${menuContrast}`);
        await page.keyboard.press('Escape');
        assert.equal(await menu.getAttribute('aria-expanded'), 'false');
        assert.equal(await menu.getAttribute('aria-label'), 'Open menu');
        assert.equal(await menu.evaluate((element) => element === document.activeElement), true, 'Closing the menu should return focus to its trigger');
      }

      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        window.scrollTo(0, 0);
      });
    }
  }

  for (const theme of ['light', 'dark']) {
    for (const width of [393, 1440]) {
      const capture = await browser.newPage({ reducedMotion: 'reduce', viewport: { width, height: width === 393 ? 852 : 900 } });
      capture.on('pageerror', (error) => errors.push(error.message));
      capture.on('request', (request) => {
        if (!request.url().startsWith(origin) && !request.url().startsWith('data:')) externalRequests.push(request.url());
      });
      await capture.goto(origin, { waitUntil: 'networkidle' });
      await capture.evaluate(() => document.fonts.ready);
      if (theme === 'dark') await capture.locator('.theme-toggle').click();
      await capture.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await capture.waitForTimeout(120);
      assert.equal(await capture.locator('html').getAttribute('data-theme'), theme, `Capture theme should be ${theme}`);
      assert.ok(await capture.locator('.product-preview').isVisible(), `Preview should be visible in ${theme} ${width}px capture`);
      assert.ok((await capture.locator('.product-preview').innerText()).includes('Portfolio value'), `Preview content should be rendered in ${theme} ${width}px capture`);
      if (width === 1440) await capture.locator('.product-preview').screenshot({ path: resolve(output, `landing-preview-${theme}-1440.png`) });
      await capture.screenshot({ path: resolve(output, `landing${theme === 'dark' ? '' : '-light'}-${width}.png`), fullPage: true });
      await capture.close();
    }
  }

  assert.deepEqual(errors, [], 'Landing threw browser errors');
  assert.deepEqual(externalRequests, [], 'Landing loaded unneeded external services');
  assert.deepEqual([...new Set(fontContentTypes)], ['font/woff2'], 'Self-hosted Inter font must be served with its font MIME type');

  await page.setViewportSize({ width: 1536, height: 647 });
  await page.goto(origin, { waitUntil: 'networkidle' });
  const [shortDesktopHeaderBounds, shortDesktopTitleBounds] = await Promise.all([
    page.locator('.site-header').boundingBox(),
    page.locator('.hero h1').boundingBox(),
  ]);
  assert.ok(shortDesktopHeaderBounds && shortDesktopTitleBounds, 'Short desktop header and hero title must be measurable');
  assert.ok(shortDesktopTitleBounds.y >= shortDesktopHeaderBounds.y + shortDesktopHeaderBounds.height, 'Hero heading must follow the header at 1536x647');
  const launchBounds = await page.locator('.hero .actions a[href="https://t.me/FxAeonBot"]').boundingBox();
  assert.ok(launchBounds && launchBounds.y + launchBounds.height <= 647, 'Primary Telegram action should fit a short desktop viewport');
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'Reduced motion must suppress entrance animations');

  const motionPage = await browser.newPage({ reducedMotion: 'no-preference', viewport: { width: 1440, height: 900 } });
  await motionPage.goto(origin, { waitUntil: 'domcontentloaded' });
  const motion = await motionPage.evaluate(() => document.getAnimations().map((animation) => animation.effect?.getTiming()));
  assert.ok(motion.length > 0, 'Hero should retain a brief entrance animation');
  assert.ok(motion.every((timing) => timing.iterations === 1 && Number(timing.duration) <= 700), 'Entrance motion must settle promptly');
  await motionPage.emulateMedia({ reducedMotion: 'reduce' });
  await motionPage.waitForFunction(() => document.getAnimations().length === 0);
  await motionPage.close();

  console.log('Landing browser checks passed: 14 theme/viewport states, preview semantics/readability, visible-content bounds, WCAG text contrast, 44px targets, menu/theme keyboard and persistence, reduced motion, and zero external requests.');
} finally {
  await browser?.close();
  server.kill();
}
