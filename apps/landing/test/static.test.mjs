import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { relative, resolve, sep } from 'node:path';
import { escapeAttribute, telegramLauncher } from '../config.mjs';

const root = resolve(import.meta.dirname, '..');
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const css = await readFile(resolve(root, 'styles.css'), 'utf8');
const script = await readFile(resolve(root, 'script.js'), 'utf8');
const aurora = await readFile(resolve(root, 'aurora.js'), 'utf8');
const builtHtml = await readFile(resolve(root, 'dist/index.html'), 'utf8');
const headers = await readFile(resolve(root, 'dist/_headers'), 'utf8');

/** The markup between an element's opening tag (matched by `open`) and its closing tag. */
function elementSource(source, open, tag) {
  const start = source.search(open);
  assert.ok(start >= 0, `Missing element ${open}`);
  let depth = 0;
  const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
  pattern.lastIndex = start;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return source.slice(start, match.index + match[0].length);
  }
  throw new Error(`Unclosed element ${open}`);
}

/** The body of the first block that opens with `prelude` in a stylesheet. */
function cssBlock(source, prelude) {
  const start = source.indexOf(prelude);
  assert.ok(start >= 0, `Missing CSS block ${prelude}`);
  let depth = 0;
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return { start, end: index, body: source.slice(start, index + 1) };
  }
  throw new Error(`Unclosed CSS block ${prelude}`);
}

test('landing has required brand assets and metadata', async () => {
  for (const asset of ['assets/fxaeon-mark.svg', 'assets/fxaeon-banner.png', 'assets/inter-latin.woff2']) await access(resolve(root, asset));
  assert.match(html, /rel="canonical" href="https:\/\/fxaeon\.xyz\//);
  assert.match(html, /property="og:image"/);
  assert.match(html, /name="twitter:image"/);
  assert.match(html, /<html lang="en" data-theme="dark">/);
  assert.deepEqual(
    await readFile(resolve(root, '../mini-app/public/brand/fx-official-mark.svg')),
    await readFile(resolve(root, 'dist/assets/fx-protocol.svg')),
    'Landing should reuse the official protocol logo without altering its source',
  );
});

test('the hero states the product, keeps Telegram primary, and the web app secondary', () => {
  assert.equal(html.match(/<h1\b/g)?.length, 1, 'There should be one page heading');
  assert.match(html, /<h1 id="hero-title">Leverage, savings, and credit\. <em class="hero-accent">Inside Telegram\.<\/em><\/h1>/);
  assert.match(html, /trade ETH and BTC with leverage, earn with fxSAVE, borrow fxUSD, and move between Ethereum and Base/);
  assert.match(html, /<a class="pill primary" href="https:\/\/t\.me\/FxAeonBot"/);
  assert.match(html, /<a class="web-link" href="https:\/\/fxaeon\.com\/">Open web app/);
  for (const id of ['moves', 'protocol', 'telegram', 'faq']) assert.equal(html.match(new RegExp(`id="${id}"`, 'g'))?.length, 1, `#${id} should exist exactly once`);
});

test('every illustration is labelled as an example and offers no fake controls', () => {
  const hero = elementSource(html, /<figure class="hero-stage"/, 'figure');
  const stage = elementSource(html, /<figure class="chapter-stage"/, 'figure');
  const review = elementSource(html, /<figure class="review-card"/, 'figure');
  const chat = elementSource(html, /<div class="chat"/, 'div');
  assert.match(hero, /role="img" aria-label="Example FxAeon portfolio/);
  assert.match(stage, /role="img" aria-label="Example FxAeon screens/);
  assert.match(review, /aria-label="Example transaction review"/);
  assert.match(chat, /role="img" aria-label="Example Telegram chat/);
  for (const phone of [hero, stage]) assert.match(phone, /<span class="example-badge">Example<\/span>/, 'Each phone shows an Example badge');
  assert.match(review, /<p class="example-badge">Example<\/p>/);
  for (const [name, source] of Object.entries({ hero, stage, review, chat })) {
    assert.doesNotMatch(source, /<(?:a|button|input|select|textarea)\b/, `The ${name} illustration must not contain interactive controls`);
  }
  // One phone screen per product chapter, each paired with a chapter that links to the app.
  for (const route of ['trade', 'earn', 'borrow', 'move']) {
    assert.match(stage, new RegExp(`<div class="screen screen-${route}" data-for="${route}"`));
    assert.match(html, new RegExp(`<li class="chapter" data-chapter="${route}">[\\s\\S]*?href="https://fxaeon\\.com/${route}"`));
  }
});

test('protocol and safety copy keeps its caveats', () => {
  assert.match(html, /Borrow at 0% annual interest/);
  assert.match(html, /Protocol fees and liquidation risk still apply/);
  assert.match(html, /Liquidation remains possible/);
  assert.match(html, /APY is variable/);
  assert.match(html, /FxAeon has no account server, delegated signer, background executor, or private-key field\. Your wallet approves each transaction\./);
  assert.match(html, /https:\/\/fxprotocol\.gitbook\.io\/fx-docs/);
});

test('markup and scripts fit the strict content security policy', () => {
  assert.doesNotMatch(html, /\sstyle=/, 'Inline style attributes are blocked by style-src');
  assert.doesNotMatch(html, /<style\b/, 'Style elements are blocked by style-src');
  assert.doesNotMatch(html, /\son[a-z]+=/i, 'Inline event handlers are blocked by script-src');
  for (const tag of html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) || []) {
    assert.match(tag, /^<script src="[^"]+"(?: defer)?><\/script>$/, `Scripts must be external files: ${tag}`);
  }
  for (const [name, source] of Object.entries({ script, aurora })) {
    assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b|\bimport\(|\beval\(|new Function/, `${name} must not reach the network or evaluate code`);
    assert.doesNotMatch(source, /setAttribute\(\s*["']style["']/, `${name} must set styles through CSSOM, which the policy allows`);
  }
});

test('product and Telegram destinations are explicit', () => {
  assert.doesNotMatch(html, /href="\/(?!")/);
  assert.match(html, /https:\/\/fxaeon\.com\//);
  assert.match(html, /https:\/\/t\.me\/FxAeonBot/);
});

test('external links use a safe target policy', () => {
  const external = html.match(/<a\b[^>]+target="_blank"[^>]*>/g) || [];
  assert.ok(external.length > 0);
  for (const tag of external) assert.match(tag, /rel="noreferrer"/);
});

test('motion is opt-in, and every loop is ambient and pausable', () => {
  const motion = cssBlock(css, '@media (prefers-reduced-motion: no-preference)');
  const outside = css.slice(0, motion.start) + css.slice(motion.end + 1);
  assert.doesNotMatch(outside.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ''), /\banimation\s*:/,
    'Animations must only be declared for visitors who have not asked for reduced motion');
  assert.match(motion.body, /:root\[data-motion="paused"\] :is\(\[data-ambient\], \[data-ambient\] \*\) \{ animation-play-state: paused !important; \}/);
  for (const rule of motion.body.match(/[^{}]+\{[^{}]*\binfinite\b[^{}]*\}/g) || []) {
    const selector = rule.slice(0, rule.indexOf('{'));
    assert.match(selector, /\[data-ambient\]|\.traveller-orbit/, `Looping animation outside an ambient region: ${selector.trim()}`);
  }
  assert.match(html, /<g class="traveller-orbit" data-ambient>/);
  assert.match(html, /<figure class="hero-stage"[^>]*data-ambient>/);
  assert.match(html, /<button class="motion-toggle" type="button">/);
  assert.match(script, /fxaeon-motion/);
  assert.match(aurora, /data-motion/);
});

test('built output includes launcher, scripts, and strict static headers', async () => {
  assert.ok(builtHtml.includes(escapeAttribute(telegramLauncher(process.env.NEXT_PUBLIC_TELEGRAM_APP_URL || undefined))));
  for (const file of ['script.js', 'aurora.js', 'styles.css']) await access(resolve(root, 'dist', file));
  assert.match(headers, /Content-Security-Policy: default-src 'self'/);
  assert.match(headers, /script-src 'self'/);
  assert.match(headers, /style-src 'self'/);
  assert.match(headers, /connect-src 'none'/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /Referrer-Policy: strict-origin-when-cross-origin/);
});

test('launcher accepts bot and mini-app links but rejects unsafe or ambiguous destinations', () => {
  assert.equal(telegramLauncher('https://t.me/FxAeonBot/app?startapp=launch_1'), 'https://t.me/FxAeonBot/app?startapp=launch_1');
  for (const value of ['https://evil.test/FxAeonBot', 'http://t.me/FxAeonBot',
    'https://user:password@t.me/FxAeonBot', 'https://t.me:444/FxAeonBot',
    'https://t.me/FxAeonBot#payload', 'https://t.me/FxAeonBot?other=1',
    'https://t.me/FxAeonBot?startapp=one&startapp=two',
    'https://t.me/FxAeonBot?startapp=%22onclick=alert(1)']) {
    assert.throws(() => telegramLauncher(value), value);
  }
});

test('crawl files advertise only the canonical landing origin', async () => {
  const robots = await readFile(resolve(root, 'dist/robots.txt'), 'utf8');
  const sitemap = await readFile(resolve(root, 'dist/sitemap.xml'), 'utf8');
  assert.match(robots, /Sitemap: https:\/\/fxaeon\.xyz\/sitemap\.xml/);
  assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]), ['https://fxaeon.xyz/']);
});

test('landing 404 is branded, nonindexable, and links home', async () => {
  const missing = await readFile(resolve(root, 'dist/404.html'), 'utf8');
  assert.match(missing, /name="robots" content="noindex"/);
  assert.match(missing, /<h1>Page not found<\/h1>/);
  assert.match(missing, /href="\/"/);
  for (const file of ['assets/fxaeon-mark.svg', 'document.css']) await access(resolve(root, 'dist', file));
});

test('standalone build succeeds in a minimal checkout with no node_modules', async () => {
  const tempRoot = await mkdtemp(resolve(tmpdir(), 'fxaeon-landing-build-'));
  const tempLanding = resolve(tempRoot, 'apps', 'landing');
  try {
    const excluded = new Set(['dist', 'node_modules', 'test']);
    await mkdir(resolve(tempRoot, 'apps'), { recursive: true });
    await cp(root, tempLanding, {
      recursive: true,
      filter(source) {
        const path = relative(root, source).split(sep).join('/');
        return path === '' || ![...excluded].some((name) => path === name || path.startsWith(`${name}/`));
      },
    });
    const brandPath = resolve(tempRoot, 'apps/mini-app/public/brand');
    await mkdir(brandPath, { recursive: true });
    await cp(resolve(root, '../mini-app/public/brand/fx-official-mark.svg'), resolve(brandPath, 'fx-official-mark.svg'));

    execFileSync(process.execPath, ['build.mjs'], { cwd: tempLanding, stdio: 'pipe' });

    await assert.rejects(access(resolve(tempRoot, 'node_modules')));
    await assert.rejects(access(resolve(tempLanding, 'node_modules')));
    for (const file of ['aurora.js', 'script.js', 'assets/icons/receive.svg', 'assets/icons/trade.svg', 'assets/icons/move.svg', 'assets/icons/earn.svg', 'assets/icons/borrow.svg', 'assets/icons/LICENSE.txt']) {
      await access(resolve(tempLanding, 'dist', file));
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('checked-in icons match the app’s pinned Lucide renderer and license', async () => {
  const appRequire = createRequire(resolve(root, '../mini-app/package.json'));
  const react = appRequire('react');
  const { renderToStaticMarkup } = appRequire('react-dom/server');
  const lucide = appRequire('lucide-react');
  const lucidePackagePath = appRequire.resolve('lucide-react/package.json');

  const icons = { receive: lucide.ArrowDownToLine, trade: lucide.CandlestickChart, move: lucide.ArrowLeftRight, earn: lucide.PiggyBank, borrow: lucide.Layers };
  for (const [name, Icon] of Object.entries(icons)) {
    const rendered = renderToStaticMarkup(react.createElement(Icon, { size: 24, color: '#c6a7ff', strokeWidth: 2 }));
    assert.equal(await readFile(resolve(root, 'assets/icons', `${name}.svg`), 'utf8'), rendered, `${name}.svg should match the pinned app icon`);
  }
  const normalizeLicenseLineEndings = (value) => value.replace(/\r\n?/g, '\n');
  assert.deepEqual(
    normalizeLicenseLineEndings(await readFile(resolve(root, 'assets/icons/LICENSE.txt'), 'utf8')),
    normalizeLicenseLineEndings(await readFile(resolve(lucidePackagePath, '../LICENSE'), 'utf8')),
    'Include the same Lucide license as the app dependency',
  );
});

test('all landing images declare text alternatives and all local resources exist', async () => {
  for (const tag of builtHtml.match(/<img\b[^>]*>/g) || []) assert.match(tag, /\balt="[^"]*"/);
  for (const [, value] of builtHtml.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    if (/^(?:https?:|#|mailto:|data:)/.test(value) || value === '/') continue;
    await access(resolve(root, 'dist', value.replace(/^\//, '').split(/[?#]/)[0]));
  }
  assert.match(headers, /Strict-Transport-Security: max-age=31536000/);
  assert.match(headers, /upgrade-insecure-requests/);
});
