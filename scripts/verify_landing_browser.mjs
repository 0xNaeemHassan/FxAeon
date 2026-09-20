import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

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

function decodePng(buffer) {
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  assert.equal(bitDepth, 8, 'Hero contrast probe expects 8-bit screenshot pixels');
  assert.ok(channels, 'Unsupported screenshot color type: ' + colorType);
  const chunks = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const name = buffer.toString('ascii', offset + 4, offset + 8);
    if (name === 'IDAT') chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
    if (name === 'IEND') break;
  }
  const packed = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let input = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = packed[input++];
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[row + x - channels] : 0;
      const above = y > 0 ? pixels[row - stride + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[row - stride + x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) {
        const estimate = left + above - upperLeft;
        const leftDistance = Math.abs(estimate - left);
        const aboveDistance = Math.abs(estimate - above);
        const upperLeftDistance = Math.abs(estimate - upperLeft);
        predictor = leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
          ? left
          : aboveDistance <= upperLeftDistance ? above : upperLeft;
      }
      pixels[row + x] = (packed[input++] + predictor) & 255;
    }
  }
  return { width, height, channels, pixels };
}

function luminance(rgb) {
  return rgb.map((channel) => channel / 255)
    .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrastRatio(first, second) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function measureRenderedTextContrast(textPixels, backdropPixels, regions) {
  const results = [];
  for (const region of regions) {
    let minimumRatio = Infinity;
    let sampleCount = 0;
    const left = Math.max(0, Math.floor(region.rect.x));
    const right = Math.min(backdropPixels.width, Math.ceil(region.rect.x + region.rect.width));
    const top = Math.max(0, Math.floor(region.rect.y));
    const bottom = Math.min(backdropPixels.height, Math.ceil(region.rect.y + region.rect.height));
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const offset = (y * backdropPixels.width + x) * backdropPixels.channels;
        const actual = [textPixels.pixels[offset], textPixels.pixels[offset + 1], textPixels.pixels[offset + 2]];
        const backdrop = [backdropPixels.pixels[offset], backdropPixels.pixels[offset + 1], backdropPixels.pixels[offset + 2]];
        const glyphVector = region.foreground.map((value, index) => value - backdrop[index]);
        const pixelVector = actual.map((value, index) => value - backdrop[index]);
        const magnitude = glyphVector.reduce((sum, value) => sum + value * value, 0);
        if (magnitude < 1) continue;
        const coverage = pixelVector.reduce((sum, value, index) => sum + value * glyphVector[index], 0) / magnitude;
        const residual = Math.sqrt(pixelVector.reduce((sum, value, index) => sum + (value - coverage * glyphVector[index]) ** 2, 0));
        if (coverage <= 0.55 || coverage >= 1.2 || residual >= 20) continue;
        sampleCount += 1;
        minimumRatio = Math.min(minimumRatio, contrastRatio(region.foreground, backdrop));
      }
    }
    results.push({
      label: region.label,
      minimum: region.minimum,
      ratio: sampleCount ? Number(minimumRatio.toFixed(2)) : null,
      sampleCount,
    });
  }
  return results;
}
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
  const heroImageContrastResults = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (!request.url().startsWith(origin) && !request.url().startsWith('data:')) {
      externalRequests.push(request.url());
    }
  });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.removeItem('fxaeon-theme'));
  for (const theme of ['dark', 'light']) {
  for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    const response = await page.goto(origin, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200);
    await page.locator('h1').waitFor({ state: 'visible' });
    assert.equal(await page.locator('h1').count(), 1);
    const themeToggle = page.locator('.theme-toggle');
    if (await page.locator('html').getAttribute('data-theme') !== theme) {
      await themeToggle.focus();
      await page.keyboard.press('Enter');
    }
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme, `Theme toggle did not apply ${theme}`);
    assert.equal(await themeToggle.getAttribute('aria-pressed'), String(theme === 'light'), `Theme toggle aria-pressed mismatch for ${theme}`);
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
    const appLink = page.locator('.hero a[href="https://fxaeon.com/"]');
    await appLink.scrollIntoViewIfNeeded();
    const state = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth,
      theme: document.documentElement.dataset.theme,
      themeColor: document.querySelector('meta[name="theme-color"]')?.content,
      headerPosition: getComputedStyle(document.querySelector('.site-header')).position,
      headerBackground: getComputedStyle(document.querySelector('.site-header')).backgroundColor,
      mobileArtOverlapsHeadline: innerWidth <= 520 && (() => { const art = document.querySelector('.hero-art').getBoundingClientRect(); const title = document.querySelector('.hero h1').getBoundingClientRect(); return art.left < title.right && art.right > title.left && art.top < title.bottom && art.bottom > title.top; })(),
      ctaHitTarget: (() => { const cta = document.querySelector('.hero .actions a[href="https://fxaeon.com/"]'); const rect = cta.getBoundingClientRect(); return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest('a')?.getAttribute('href') || null; })(),
      overflow: [...document.querySelectorAll('body *')].filter((element) => element.getBoundingClientRect().right > innerWidth + 1).map((element) => ({ tag: element.tagName, class: element.className })),
      images: [...document.images].filter((image) => image.getBoundingClientRect().width > 0).map((image) => ({
        loaded: image.complete && image.naturalWidth > 0,
        ratioError: Math.abs(image.width / image.height - image.naturalWidth / image.naturalHeight),
      })),
      links: [...document.querySelectorAll('a')].map((link) => link.getAttribute('href')),
      featureHrefs: [...document.querySelectorAll('.feature-list > a.feature')].map((link) => link.getAttribute('href')),
      undersizedControls: [...document.querySelectorAll('.site-header .brand, .site-header nav a, .site-header .social, .site-header .theme-toggle, .site-header .pill, .site-header .menu, .hero .actions a, .feature-list > a.feature, .closing a.pill, footer .brand, .footer-links a')].flatMap((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0) return [];
        return rect.width < 44 || rect.height < 44
          ? [{ text: element.textContent.trim().replace(/\s+/g, ' ').slice(0, 60), width: rect.width, height: rect.height }]
          : [];
      }),
      contrast: (() => {
        const parse = (value) => {
          const color = value.trim();
          if (/^#[\da-f]{3}$/i.test(color)) return [...color.slice(1)].map((digit) => Number.parseInt(digit + digit, 16));
          if (/^#[\da-f]{6}$/i.test(color)) return [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16));
          const match = value.match(/rgba?\(([^)]+)\)/);
          if (!match) return null;
          const channels = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
          if (channels.length < 3 || (channels[3] ?? 1) < 0.99) return null;
          return channels.slice(0, 3);
        };
        const luminance = (rgb) => rgb.map((channel) => channel / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
        const ratio = (foreground, background) => {
          const first = luminance(foreground);
          const second = luminance(background);
          return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
        };
        const bodyBackground = parse(getComputedStyle(document.body).backgroundColor);
        const surfaceFor = (element) => {
          const rootStyle = getComputedStyle(document.documentElement);
          for (let node = element; node && node.tagName !== 'BODY'; node = node.parentElement) {
            const background = parse(getComputedStyle(node).backgroundColor);
            if (background) return background;
          }
          if (element.closest('.site-header, .hero')) return parse(rootStyle.getPropertyValue('--hero-bg')) || bodyBackground;
          if (element.closest('.showcase')) return parse(rootStyle.getPropertyValue('--showcase-bg')) || bodyBackground;
          if (element.closest('.product')) return parse(rootStyle.getPropertyValue('--product-bg')) || bodyBackground;
          if (element.closest('.closing')) return parse(rootStyle.getPropertyValue('--closing-bg')) || bodyBackground;
          if (element.closest('footer')) return parse(rootStyle.getPropertyValue('--page-bg')) || bodyBackground;
          return bodyBackground;
        };
        const collect = (selector) => [...document.querySelectorAll(selector)].filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
       }).map((element) => {
         const foreground = parse(getComputedStyle(element).color);
          const style = getComputedStyle(element);
          const background = surfaceFor(element);
          const fontSize = Number.parseFloat(style.fontSize);
          const largeText = fontSize >= 24 || (fontSize >= 18.66 && Number.parseInt(style.fontWeight, 10) >= 700);
          return { text: element.textContent.trim().replace(/\s+/g, ' ').slice(0, 60), ratio: foreground && background ? ratio(foreground, background) : null, minimum: largeText ? 3 : 4.5 };
        });
        return {
          header: collect('.site-header .brand, .site-header nav a, .site-header .social, .site-header .theme-toggle, .site-header .menu, .site-header .pill, .hero h1, .hero h1 em, .hero .lede, .hero .micro, .hero .actions a'),
          body: collect('.showcase h2, .showcase .showcase-note, .section-heading h2, .section-heading h2 em, .section-heading > p, .feature-body h3, .feature-body p, .feature-body small, .learn, .feature-sources, .feature-sources a, .closing h2, .closing h2 em'),
          footer: collect('footer .brand, .footer-links a'),
        };
      })(),
    }));
    assert.ok(state.contentWidth <= state.width + 1, `Horizontal overflow at ${width}px: ${JSON.stringify(state.overflow)}`);
    assert.equal(state.theme, theme, `Unexpected rendered theme at ${width}px`);
    assert.equal(state.themeColor, theme === 'dark' ? '#0d0b14' : '#e8def7', `Theme color metadata mismatch for ${theme}`);
    assert.equal(state.headerPosition, 'absolute', `Header should overlay the hero at ${width}px`);
    assert.ok(state.headerBackground === 'rgba(0, 0, 0, 0)' || state.headerBackground === 'transparent', `Header is not transparent at ${width}px: ${state.headerBackground}`);
    if (width <= 520) assert.ok(state.mobileArtOverlapsHeadline, `Hero artwork should sit behind the mobile headline at ${width}px`);
    assert.equal(state.ctaHitTarget, 'https://fxaeon.com/', `Hero CTA is blocked by artwork at ${width}px`);
    assert.ok(state.images.every((image) => image.loaded), `Missing image at ${width}px`);
    assert.ok(state.images.every((image) => image.ratioError < 0.02), `Distorted image at ${width}px`);
    assert.deepEqual([...new Set(state.featureHrefs)].sort(), [...FEATURE_HREFS].sort(), `Feature destinations must include trade, earn, borrow, and move at ${width}px`);
    assert.deepEqual(state.undersizedControls, [], `Interactive targets shorter than 44px at ${width}px: ${JSON.stringify(state.undersizedControls)}`);
    for (const surface of [...state.contrast.header, ...state.contrast.body, ...state.contrast.footer]) {
      assert.ok(surface.ratio !== null && surface.ratio >= surface.minimum, `Insufficient text contrast at ${width}px: ${JSON.stringify(surface)}`);
    }
    for (const href of state.links) {
      assert.ok(href, 'An anchor is missing its destination');
      if (href.startsWith('/') || href.startsWith('#')) {
        assert.ok(href === '/' || href.startsWith('#'), `Product link remained relative: ${href}`);
      }
      if (href.startsWith('#')) assert.equal(await page.locator(href).count(), 1);
    }
    await appLink.click({ trial: true });
    const menu = page.locator('button.menu');
    if (await menu.isVisible()) {
      await menu.focus();
      await page.keyboard.press('Enter');
      assert.equal(await menu.getAttribute('aria-expanded'), 'true');
      assert.equal(await menu.getAttribute('aria-label'), 'Close menu');
      assert.equal(await page.locator('.site-header nav a').first().evaluate((element) => element === document.activeElement), true, 'Opening the menu should move focus into navigation');
      const menuContrast = await page.locator('.site-header nav a').first().evaluate((element) => {
        const parse = (value) => { const match = value.match(/rgba?\(([^)]+)\)/); return match ? match[1].split(',').slice(0, 3).map((part) => Number.parseFloat(part.trim())) : null; };
        const lum = (rgb) => rgb.map((channel) => channel / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
        const foreground = parse(getComputedStyle(element).color);
        const background = parse(getComputedStyle(element.parentElement).backgroundColor);
        if (!foreground || !background) return null;
        const first = lum(foreground); const second = lum(background);
        return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
      });
      assert.ok(menuContrast !== null && menuContrast >= 4.5, 'Open mobile menu contrast is too low: ' + menuContrast);
      await page.keyboard.press('Escape');
      assert.equal(await menu.getAttribute('aria-expanded'), 'false');
      assert.equal(await menu.getAttribute('aria-label'), 'Open menu');
      assert.equal(await menu.evaluate((element) => element === document.activeElement), true);
    }
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo(0, 0);
    });
    if (width === 390 || width === 1440) {
      const filename = theme === 'dark' ? `landing-${width}.png` : `landing-light-${width}.png`;
      await page.screenshot({ path: resolve(output, filename), fullPage: true });
      if (width === 390) {
        const hero = page.locator('.hero');
        const textRegions = await page.evaluate(() => {
          const heroBounds = document.querySelector('.hero').getBoundingClientRect();
          const regions = [];
          for (const [selector, label] of [['.hero h1', 'headline'], ['.hero .lede', 'lede'], ['.hero .micro', 'micro']]) {
            const root = document.querySelector(selector);
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            const groups = new Map();
            while (walker.nextNode()) {
              const node = walker.currentNode;
              if (!node.nodeValue.trim()) continue;
              const style = getComputedStyle(node.parentElement);
              const color = style.color.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
              if (!color) continue;
              const fontSize = Number.parseFloat(style.fontSize);
              const fontWeight = Number.parseInt(style.fontWeight, 10);
              const minimum = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
              const key = color.join(',') + ':' + minimum;
              const group = groups.get(key) || { label, foreground: color, minimum, rect: { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity } };
              const range = document.createRange();
              range.selectNodeContents(node);
              for (const bounds of range.getClientRects()) {
                group.rect.left = Math.min(group.rect.left, bounds.left - heroBounds.left);
                group.rect.top = Math.min(group.rect.top, bounds.top - heroBounds.top);
                group.rect.right = Math.max(group.rect.right, bounds.right - heroBounds.left);
                group.rect.bottom = Math.max(group.rect.bottom, bounds.bottom - heroBounds.top);
              }
              groups.set(key, group);
            }
            for (const group of groups.values()) {
              regions.push({
                label: label + ' (' + group.foreground.join(', ') + ')',
                foreground: group.foreground,
                minimum: group.minimum,
                rect: { x: group.rect.left, y: group.rect.top, width: group.rect.right - group.rect.left, height: group.rect.bottom - group.rect.top },
              });
            }
          }
          return regions;
        });
        const visibleText = decodePng(await hero.screenshot({ path: resolve(output, 'landing-hero-390-' + theme + '.png') }));
        await page.evaluate(() => {
          for (const element of document.querySelectorAll('.hero h1, .hero .lede, .hero .micro')) {
            element.style.setProperty('visibility', 'hidden', 'important');
            element.style.setProperty('text-shadow', 'none', 'important');
          }
        });
        const backdrop = decodePng(await hero.screenshot());
        await page.evaluate(() => {
          for (const element of document.querySelectorAll('.hero h1, .hero .lede, .hero .micro')) {
            element.style.removeProperty('visibility');
            element.style.removeProperty('text-shadow');
          }
        });
        assert.equal(visibleText.width, backdrop.width, 'Hero text and backdrop captures differ in width');
        assert.equal(visibleText.height, backdrop.height, 'Hero text and backdrop captures differ in height');
        const measurements = measureRenderedTextContrast(visibleText, backdrop, textRegions);
        heroImageContrastResults.push({ theme, measurements });
        for (const measurement of measurements) {
          assert.ok(
            measurement.sampleCount > 0 && measurement.ratio !== null && measurement.ratio >= measurement.minimum,
            theme + ' ' + measurement.label + ' contrast over rendered hero art is ' + measurement.ratio + ':1; requires ' + measurement.minimum + ':1 (' + measurement.sampleCount + ' glyph pixels)',
          );
        }
      }
    }
  }
  }
  assert.deepEqual(errors, [], 'Landing threw browser errors');
  assert.deepEqual(externalRequests, [], 'Landing loaded unneeded external services');
  await page.setViewportSize({ width: 1440, height: 650 });
  await page.goto(origin, { waitUntil: 'networkidle' });
  const launchBounds = await page.locator('.hero a[href="https://fxaeon.com/"]').boundingBox();
  assert.ok(launchBounds && launchBounds.y + launchBounds.height <= 650, 'Primary action must fit a short desktop viewport');
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'Reduced motion must suppress entrance animations');

  const motionPage = await browser.newPage({ reducedMotion: 'no-preference', viewport: { width: 1440, height: 900 } });
  await motionPage.goto(origin, { waitUntil: 'domcontentloaded' });
  const motion = await motionPage.evaluate(() => document.getAnimations().map((animation) => animation.effect?.getTiming()));
  assert.ok(motion.length > 0, 'Hero should have visible entrance motion');
  assert.ok(motion.every((timing) => timing.iterations === 1 && Number(timing.duration) <= 700), 'Entrance motion must settle promptly');
  const motionArt = motionPage.locator('.hero-art');
  const artBounds = await motionArt.boundingBox();
  await motionPage.mouse.move(artBounds.x + artBounds.width * 0.75, artBounds.y + artBounds.height / 2);
  assert.notEqual(await motionPage.locator('.hero-frame').evaluate((element) => getComputedStyle(element).getPropertyValue('--hero-shift-x').trim()), '', 'Hero artwork should respond to pointer movement');
  await motionPage.emulateMedia({ reducedMotion: 'reduce' });
  await motionPage.waitForFunction(() => document.getAnimations().length === 0);
  const frameBeforePointer = await motionPage.locator('.hero-frame').evaluate((element) => getComputedStyle(element).transform);
  const reducedBounds = await motionArt.boundingBox();
  await motionPage.mouse.move(reducedBounds.x + reducedBounds.width * 0.25, reducedBounds.y + reducedBounds.height / 2);
  assert.equal(await motionPage.locator('.hero-frame').evaluate((element) => getComputedStyle(element).transform), frameBeforePointer, 'Reduced motion must disable pointer-driven artwork movement');
  await motionPage.close();
  console.log('Landing browser checks passed: fourteen theme/viewport states, rendered hero-art contrast ' + JSON.stringify(heroImageContrastResults) + ', menu/theme keyboard, 44px targets, reduced motion, and zero external requests.');
} finally {
  await browser?.close();
  server.kill();
}
