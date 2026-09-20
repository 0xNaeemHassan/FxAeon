import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { escapeAttribute, telegramLauncher } from '../config.mjs';

const root = resolve(import.meta.dirname, '..');
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const builtHtml = await readFile(resolve(root, 'dist/index.html'), 'utf8');
const headers = await readFile(resolve(root, 'dist/_headers'), 'utf8');

test('landing has required brand assets and metadata', async () => {
  for (const asset of ['assets/fxaeon-mark.svg', 'assets/fxaeon-sculpture.webp', 'assets/fxaeon-banner.png', 'assets/portfolio-preview.png', 'assets/portfolio-mobile.png']) await access(resolve(root, asset));
  assert.match(html, /rel="canonical" href="https:\/\/fxaeon\.xyz\//);
  assert.match(html, /property="og:image"/);
  assert.match(html, /name="twitter:image"/);
});

test('product and Telegram destinations are explicit', () => {
  assert.doesNotMatch(html, /href="\/(?!")/);
  assert.match(html, /https:\/\/fxaeon\.com\//);
  assert.match(html, /https:\/\/t\.me\/FxAeonBot/);
  assert.match(html, /f\(x\) protocol docs/);
  assert.match(html, /Built with f\(x\) SDK/);
});

test('external links use a safe target policy', () => {
  const external = html.match(/<a\b[^>]+target="_blank"[^>]*>/g) || [];
  for (const tag of external) assert.match(tag, /rel="noreferrer"/);
});

test('built output includes launcher and strict static headers', () => {
  assert.ok(builtHtml.includes(escapeAttribute(telegramLauncher(process.env.NEXT_PUBLIC_TELEGRAM_APP_URL || undefined))));
  assert.match(headers, /Content-Security-Policy: default-src 'self'/);
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

test('all landing images declare text alternatives and all local resources exist', async () => {
  for (const tag of builtHtml.match(/<img\b[^>]*>/g) || []) assert.match(tag, /\balt="[^"]*"/);
  for (const [, value] of builtHtml.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    if (/^(?:https?:|#|mailto:|data:)/.test(value) || value === '/') continue;
    await access(resolve(root, 'dist', value.replace(/^\//, '').split(/[?#]/)[0]));
  }
  assert.match(headers, /Strict-Transport-Security: max-age=31536000/);
  assert.match(headers, /upgrade-insecure-requests/);
});
