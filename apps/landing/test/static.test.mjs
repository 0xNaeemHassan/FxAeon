import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { relative, resolve, sep } from 'node:path';
import { escapeAttribute, telegramLauncher, telegramStartLink } from '../config.mjs';
import { qrModules, qrSvg } from '../qr.mjs';

const root = resolve(import.meta.dirname, '..');
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const css = await readFile(resolve(root, 'styles.css'), 'utf8');
const script = await readFile(resolve(root, 'script.js'), 'utf8');
const aurora = await readFile(resolve(root, 'aurora.js'), 'utf8');
const builtHtml = await readFile(resolve(root, 'dist/index.html'), 'utf8');
const headers = await readFile(resolve(root, 'dist/_headers'), 'utf8');
const appRequire = createRequire(resolve(root, '../mini-app/package.json'));
const DESKTOP = '(hover: hover) and (pointer: fine) and (min-width: 861px)';

/** `value` as a literal inside a RegExp: every metacharacter, backslash included, escaped. */
const literal = (value) => value.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

/** The text of a markup fragment: tags removed, then any stray angle bracket, so no tag can survive. */
const textOf = (markup, separator = '') => markup.replace(/<[^>]*>/g, separator).replace(/[<>]/g, '');

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

/** Each link in `source` as "class destination text", grouped by the devices that show it. */
function linksByDevice(source) {
  const shown = { mobile: [], desktop: [] };
  for (const [, attributes, text] of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
    const attribute = (name) => attributes.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
    const device = attribute('data-device');
    const link = [attribute('class'), attribute('href'), textOf(text).trim()].filter(Boolean).join(' ');
    for (const name of Object.keys(shown)) if (!device || device === name) shown[name].push(link);
  }
  return shown;
}

/** The QR symbol qrcode.react draws for `value`, read back from its SVG path. */
function referenceQr(value, level, boostLevel) {
  const react = appRequire('react');
  const { renderToStaticMarkup } = appRequire('react-dom/server');
  const { QRCodeSVG } = appRequire('qrcode.react');
  const svg = renderToStaticMarkup(react.createElement(QRCodeSVG, { value, level, boostLevel, marginSize: 0 }));
  return modulesFromPath(svg.match(/<path fill="#000000" d="([^"]*)"/)[1], Number(svg.match(/viewBox="0 0 (\d+) \1"/)[1]));
}

function modulesFromPath(path, size, offset = 0) {
  const grid = Array.from({ length: size }, () => new Array(size).fill(false));
  for (const [, x, y, width] of path.matchAll(/M(\d+)[ ,](\d+) ?h(\d+)/g)) {
    for (let step = 0; step < Number(width); step += 1) grid[Number(y) - offset][Number(x) - offset + step] = true;
  }
  return grid;
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

test('the hero states the product and leads with Telegram on phones and the web app on desktop', () => {
  assert.equal(html.match(/<h1\b/g)?.length, 1, 'There should be one page heading');
  assert.match(html, /<h1 id="hero-title">Leverage, savings, and credit\. <em class="hero-accent">Inside Telegram\.<\/em><\/h1>/);
  assert.match(html, /trade ETH and BTC with leverage, earn with fxSAVE, borrow fxUSD, and move between Ethereum and Base/);
  const heroActions = elementSource(elementSource(html, /<section class="hero"/, 'section'), /<div class="actions">/, 'div');
  const finaleActions = elementSource(elementSource(html, /<section class="finale"/, 'section'), /<div class="actions">/, 'div');
  for (const actions of [heroActions, finaleActions]) {
    assert.deepEqual(linksByDevice(actions), {
      mobile: ['pill primary https://t.me/FxAeonBot Open in Telegram ↗', 'secondary https://fxaeon.com/ Open web app →'],
      desktop: ['pill primary https://fxaeon.com/ Open web app →', 'secondary https://t.me/FxAeonBot Open in Telegram ↗'],
    });
  }
  assert.deepEqual(linksByDevice(elementSource(html, /<div class="header-actions">/, 'div')), {
    mobile: ['pill small https://t.me/FxAeonBot Open in Telegram ↗'],
    desktop: ['pill small https://fxaeon.com/ Open web app →'],
  });
  // Desktop visitors get a code for their phone beside the Telegram action; it is a picture, not a control.
  assert.match(heroActions, /<figure class="telegram-qr" data-device="desktop">\s*<img src="assets\/telegram-qr\.svg" width="88" height="88" alt="QR code" loading="lazy" decoding="async" \/>\s*<figcaption>Scan with your phone to open FxAeon in Telegram\.<\/figcaption>\s*<\/figure>/);
  // The same code appears once more, in the open menu's desktop card; lazy, so phones never fetch it.
  assert.equal(html.match(/telegram-qr\.svg/g)?.length, 2, 'One QR code in the hero and one in the menu');
  assert.match(elementSource(html, /<div class="menu-card" data-device="desktop">/, 'div'), /<img src="assets\/telegram-qr\.svg" width="104" height="104" alt="QR code" loading="lazy" decoding="async" \/>/);
  // Media queries choose the set before the first paint: no user-agent sniffing, no script.
  assert.match(css, new RegExp(`@media ${literal(DESKTOP)} \\{\\s*:root \\[data-device="mobile"\\] \\{ display: none; \\}`));
  assert.match(css, new RegExp(`@media not all and ${literal(DESKTOP)} \\{\\s*:root \\[data-device="desktop"\\] \\{ display: none; \\}\\s*\\}`));
  for (const source of [script, aurora]) assert.doesNotMatch(source, /userAgent|maxTouchPoints|ontouchstart|data-device|dataset\.device/);
  for (const id of ['moves', 'protocol', 'telegram', 'faq']) assert.equal(html.match(new RegExp(`id="${id}"`, 'g'))?.length, 1, `#${id} should exist exactly once`);
  assert.match(html, /<h2 id="moves-title">Everything f\(x\) Protocol SDK does, a tap away\.<\/h2>/);
  assert.match(html, />Explore f\(x\) Protocol <span aria-hidden="true">↗<\/span><\/a>/);
  assert.match(html, /Every transaction checked and simulated before signing/);
});

test('the header opens a fullscreen menu: a native modal dialog with a ruled list and ways in', () => {
  // The header keeps the brand, the theme toggle, the device's action, and a Menu pill; its links moved into the menu.
  const header = elementSource(html, /<header class="site-header">/, 'header');
  assert.doesNotMatch(header, /<nav\b/, 'The header has no inline navigation');
  assert.match(header, /<button class="menu-toggle" type="button" aria-label="Open menu" aria-controls="site-menu" aria-expanded="false" aria-haspopup="dialog"><span class="menu-words" aria-hidden="true"><span>Menu<\/span><span>Close<\/span><\/span><span class="menu-lines" aria-hidden="true"><i><\/i><i><\/i><\/span><\/button>/);
  assert.equal(html.match(/<dialog\b/g)?.length, 1);
  const menu = elementSource(html, /<dialog class="site-menu" id="site-menu" aria-label="Menu">/, 'dialog');

  // Its bar repeats the header, so the Close pill opens where the Menu pill was, and takes focus.
  const bar = elementSource(menu, /<div class="menu-bar">/, 'div');
  assert.deepEqual(linksByDevice(elementSource(bar, /<div class="header-actions">/, 'div')), linksByDevice(elementSource(header, /<div class="header-actions">/, 'div')));
  assert.match(bar, /<a class="brand" href="\/" aria-label="FxAeon home">/);
  assert.match(bar, /<button class="theme-toggle" type="button" aria-label="Switch to light theme">/);
  assert.match(bar, /<button class="menu-toggle menu-close" type="button" aria-label="Close menu" autofocus>/);

  // The list keeps the old navigation's id and anchors: six rows in order, no numbers, the external ones marked ↗.
  assert.equal(html.match(/id="main-navigation"/g)?.length, 1);
  const nav = elementSource(menu, /<nav class="menu-nav" id="main-navigation" aria-label="Main navigation">/, 'nav');
  const rows = [...nav.matchAll(/<(button|a) class="menu-row"([^>]*)>([\s\S]*?)<\/\1>/g)].map(([, tag, attributes, inner]) => ({
    tag,
    href: attributes.match(/\bhref="([^"]*)"/)?.[1],
    external: /target="_blank" rel="noreferrer"/.test(attributes),
    label: textOf(inner.replace(/<svg[\s\S]*?<\/svg>/g, '')).trim(),
    mark: inner.match(/<svg class="(menu-[a-z]+)"/)?.[1],
  }));
  assert.deepEqual(rows, [
    { tag: 'button', href: undefined, external: false, label: 'Features', mark: 'menu-chevron' },
    { tag: 'a', href: '#protocol', external: false, label: 'f(x) Protocol', mark: 'menu-arrow' },
    { tag: 'a', href: '#telegram', external: false, label: 'Telegram', mark: 'menu-arrow' },
    { tag: 'a', href: '#faq', external: false, label: 'FAQ', mark: 'menu-arrow' },
    { tag: 'a', href: 'https://fxaeon.com/docs', external: true, label: 'Docs', mark: 'menu-arrow' },
    { tag: 'a', href: 'https://github.com/fxaeon/FxAeon', external: true, label: 'Source code', mark: 'menu-arrow' },
  ]);
  assert.doesNotMatch(menu + css + script, /menu-index/, 'The list has no number column');
  assert.match(nav, /<button class="menu-row" type="button" aria-expanded="false" aria-controls="menu-features">/);
  assert.match(nav, /<div class="menu-sub" id="menu-features">/);

  // The side column: the bot's code and the web app on desktop, Telegram on phones, then where to follow.
  const card = elementSource(menu, /<div class="menu-card" data-device="desktop">/, 'div');
  assert.match(card, /<figure class="menu-qr">\s*<img src="assets\/telegram-qr\.svg"[^>]*>\s*<figcaption>Scan to open in Telegram<\/figcaption>\s*<\/figure>/);
  assert.deepEqual(linksByDevice(card).desktop, ['text-link https://fxaeon.com/ Open web app →']);
  const chips = ['menu-chip https://t.me/FxAeonBot Telegram ↗', 'menu-chip https://github.com/fxaeon/FxAeon GitHub ↗', 'menu-chip https://fxaeon.com/docs Docs ↗'];
  assert.deepEqual(linksByDevice(elementSource(menu, /<div class="menu-side">/, 'div').replace(card, '')), {
    mobile: ['pill primary https://t.me/FxAeonBot Open in Telegram ↗', ...chips],
    desktop: chips,
  });
  // Group labels read like the page's own, and the menu states only what is true today.
  assert.deepEqual([...menu.matchAll(/<h2 class="menu-kicker">([^<]*)<\/h2>/g)].map(([, text]) => text), ['Open FxAeon', 'Connect']);
  assert.doesNotMatch(css, /text-transform:\s*uppercase/, 'The landing uses no uppercase eyebrow labels');
  assert.match(menu, /<p class="menu-foot">FxAeon · Built on f\(x\) Protocol<\/p>/);
  assert.doesNotMatch(textOf(menu, ' '),/\d+(?:\.\d+)?\s*%|\$\s?\d|APY|official|phishing|scam|risk|guarantee/i);

  // Behaviour: the browser's modal dialog, an animated close on Escape, a locked page, and nothing left of the old dropdown.
  assert.match(script, /menu\.showModal\(\)/);
  assert.match(script, /menu\.addEventListener\("cancel", \(event\) => \{\s*event\.preventDefault\(\);\s*closeMenu\(\);/);
  assert.match(script, /menu\.addEventListener\("close", /);
  assert.match(script, /else menuButton\.focus\(\{ preventScroll: true \}\)/, 'Closing returns focus to the Menu pill');
  assert.match(script, /closeMenu\(\(\) => window\.location\.assign\(link\.href\)\)/, 'A section link closes the menu, then follows the link');
  assert.match(css, /:root\[data-menu-open\] \{ overflow: hidden; \}/);
  assert.match(css, /:root:not\(\[data-js\]\) \.menu-toggle \{ display: none; \}/);
  assert.match(css, /--menu-size: clamp\(/, 'Labels scale with the screen');
  assert.match(css, /\.menu-list > li::before, \.menu-list::after \{[^}]*background: var\(--line\);/, 'Hairlines rule the list');
  assert.doesNotMatch(css, /\.site-header nav|nav\.open|\.menu[\s{[:,]/, 'No rules remain for the old dropdown');
  assert.doesNotMatch(script, /classList\.toggle\("open"|querySelector\("\.menu"\)|\.site-header nav/, 'No script remains for the old dropdown');
  // Without motion the menu fades; every travel, stagger, and drawn line waits for motion to be welcome.
  assert.match(script, /motion = still\(\)\s*\? menu\.animate\(\{ opacity: \[0, 1\] \}/);
  const motion = cssBlock(css, '@media (prefers-reduced-motion: no-preference)');
  const outside = css.slice(0, motion.start) + css.slice(motion.end + 1);
  for (const hidden of ['.menu-text { transform: translate3d(0, 115%, 0); }', '.menu-list::after { transform: scaleX(0); }', ':is(.menu-side, .menu-foot) { opacity: 0;']) {
    assert.ok(motion.body.includes(hidden), `${hidden} is part of the motion`);
    assert.ok(!outside.includes(hidden), `${hidden} must not apply under reduced motion`);
  }
});

test('illustrations are described as examples and offer no fake controls', () => {
  const hero = elementSource(html, /<figure class="hero-stage"/, 'figure');
  const stage = elementSource(html, /<figure class="chapter-stage"/, 'figure');
  const review = elementSource(html, /<figure class="review-card"/, 'figure');
  const chat = elementSource(html, /<div class="chat"/, 'div');
  assert.match(hero, /role="img" aria-label="Example FxAeon portfolio/);
  assert.match(stage, /role="img" aria-label="Example FxAeon screens/);
  assert.match(review, /aria-label="Example transaction review"/);
  assert.match(chat, /role="img" aria-label="Example Telegram chat/);
  for (const [name, source] of Object.entries({ hero, stage, review, chat })) {
    assert.doesNotMatch(source, /<(?:a|button|input|select|textarea)\b/, `The ${name} illustration must not contain interactive controls`);
  }
  // One phone screen per product chapter, each paired with a chapter that links to the app.
  for (const route of ['trade', 'earn', 'borrow', 'move']) {
    assert.match(stage, new RegExp(`<div class="screen screen-${route}" data-for="${route}"`));
    assert.match(html, new RegExp(`<li class="chapter" data-chapter="${route}">[\\s\\S]*?href="https://fxaeon\\.com/${route}"`));
  }
});

test('section buttons open their screen in the Mini App on phones and keep the web page', async () => {
  const sections = [
    ['trade', 'Trade', elementSource(html, /<li class="chapter" data-chapter="trade">/, 'li')],
    ['earn', 'Earn', elementSource(html, /<li class="chapter" data-chapter="earn">/, 'li')],
    ['borrow', 'Borrow', elementSource(html, /<li class="chapter" data-chapter="borrow">/, 'li')],
    ['move', 'Move', elementSource(html, /<li class="chapter" data-chapter="move">/, 'li')],
    ['earn', 'Earn', elementSource(html, /<article class="scene scene-pool"/, 'article')],
    ['move', 'Move', elementSource(html, /<article class="duo-item" aria-labelledby="bridge-title">/, 'article')],
  ];
  for (const [route, name, source] of sections) {
    assert.deepEqual(linksByDevice(source), {
      mobile: [`text-link https://t.me/FxAeonBot?startapp=${route} Open ${name} in Telegram ↗`, `text-link quiet https://fxaeon.com/${route} Open ${name} on the web →`],
      desktop: [`text-link https://fxaeon.com/${route} Open ${name} →`],
    }, `${name} section links`);
  }
  // The menu's Features row opens the same four screens the same way, one link per device.
  const routes = [['trade', 'Trade'], ['earn', 'Earn'], ['borrow', 'Borrow'], ['move', 'Move']];
  assert.deepEqual(linksByDevice(elementSource(html, /<div class="menu-sub" id="menu-features">/, 'div')), {
    mobile: ['#moves Overview', ...routes.map(([route, name]) => `https://t.me/FxAeonBot?startapp=${route} Open ${name} in Telegram ↗`)],
    desktop: ['#moves Overview', ...routes.map(([route, name]) => `https://fxaeon.com/${route} Open ${name} →`)],
  }, 'Menu feature links');
  // Every start parameter on the page is one the app routes, to the screen its web link opens.
  const telegram = await readFile(resolve(root, '../mini-app/src/lib/telegram.ts'), 'utf8');
  const listed = telegram.match(/const START_PARAM_ROUTES[^=]*= new Map\(\[([\s\S]*?)\]\);/)?.[1];
  assert.ok(listed, 'The app lists the start parameters it routes');
  const appRoutes = new Map([...listed.matchAll(/\['([a-z-]+)', '([^']+)'\]/g)].map(([, startParam, path]) => [startParam, path]));
  const used = [...html.matchAll(/href="https:\/\/t\.me\/FxAeonBot\?startapp=([^"]*)"/g)].map(([, startParam]) => startParam);
  assert.equal(used.length, sections.length + routes.length);
  for (const startParam of used) assert.equal(appRoutes.get(startParam), `/${startParam}`, `The app opens /${startParam} for startapp=${startParam}`);
});

test('protocol and safety copy keeps its caveats', () => {
  assert.match(html, /Borrow at 0% annual interest/);
  assert.match(html, /Protocol fees and liquidation risk still apply/);
  assert.match(html, /Liquidation remains possible/);
  assert.match(html, /APY is variable/);
  assert.match(html, /it is not an algorithmic stablecoin/);
  assert.match(html, /Governance can change these lines/);
  assert.match(html, /FxAeon has no account server, delegated signer, background executor, or private-key field\. Your wallet approves each transaction\./);
  assert.match(html, /https:\/\/fxprotocol\.gitbook\.io\/fx-docs/);
});

test('the f(x) Protocol story explains the split, the brake, the peg, and the pool', () => {
  const story = elementSource(html, /<section class="protocol" id="protocol"/, 'section');
  assert.match(story, /<h2 id="protocol-title">How f\(x\) Protocol works\.<\/h2>/);
  for (const id of ['split', 'brake', 'peg', 'pool']) assert.match(story, new RegExp(`<article class="scene scene-${id}" aria-labelledby="${id}-title">`));
  // The split's premise is arithmetic the readouts start from: 3 ETH at $3,000 against 6,000 fxUSD.
  assert.match(story, /Say you open 1 ETH at 3× with ETH at \$3,000\. Fees aside, the position holds 3 ETH: 6,000 fxUSD is minted against it, and the other \$3,000 is your share\./);
  assert.match(story, /data-split="share">\$3,000</);
  assert.match(story, /data-split="collateral">\$9,000</);
  assert.match(story, /data-split="leverage">3\.0×</);
  assert.match(script, /const SPLIT = \{ eth: 3, debt: 6000, price: 3000,/);
  // The range stays above the 3× rebalance line (a 24.24% fall), where the sketch would stop being true.
  assert.match(story, /<input id="split-price" type="range" min="-20" max="20" step="1" value="0"/);
  // Brake figures are the f(x) Protocol docs' published table (rebalance at 88% LTV, liquidation at 95%).
  const docsTable = { 2: [43.18, 47.37], 3: [24.24, 29.82], 4: [14.77, 21.05], 5: [9.09, 15.79], 6: [5.3, 12.28], 7: [2.6, 9.77] };
  const brakeSource = script.match(/const BRAKE = (\{[^;]+\});/)?.[1];
  assert.ok(brakeSource, 'The brake table is declared in script.js');
  assert.deepEqual(JSON.parse(brakeSource.replace(/(\d):/g, '"$1":')), docsTable, 'The brake table must match the docs exactly');
  for (const [leverage, [rebalance, liquidation]] of Object.entries(docsTable)) {
    const lineLtv = (fall) => (1 - 1 / Number(leverage)) / (1 - fall / 100);
    assert.ok(Math.abs(lineLtv(rebalance) - 0.88) < 0.0002, `${leverage}× rebalance distance matches the 88% line`);
    assert.ok(Math.abs(lineLtv(liquidation) - 0.95) < 0.0002, `${leverage}× liquidation distance matches the 95% line`);
  }
  assert.match(story, /data-brake="rebalance">24\.24</);
  assert.match(story, /data-brake="liquidation">29\.82</);
  assert.match(story, /aria-pressed="true">3×<\/button>/);
});

test('the SDK board lists exactly the locked f(x) Protocol SDK surface', async () => {
  const scope = await readFile(resolve(root, '../../docs/sdk-scope.md'), 'utf8');
  const locked = scope.match(/## Locked public surface[\s\S]*?```text\r?\n([\s\S]*?)```/)?.[1].trim().split(/\s+/);
  assert.equal(locked?.length, 15, 'docs/sdk-scope.md should lock fifteen methods');
  const board = elementSource(html, /<div class="sdk-board"/, 'div');
  const listed = [...board.matchAll(/<li data-method="([A-Za-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...listed].sort(), [...locked].sort(), 'Every locked method appears once and nothing else does');
  assert.match(html, /FxAeon is built on fifteen methods of the official f\(x\) Protocol SDK/);
  // Each screen lights only locked methods, and every write method is marked as one.
  const screens = script.match(/const SCREENS = \{([\s\S]*?)\n    \};/)?.[1];
  assert.ok(screens, 'SCREENS mapping is present');
  const mapped = [...screens.matchAll(/methods: \[([^\]]*)\]/g)].flatMap((match) => [...match[1].matchAll(/"([A-Za-z]+)"/g)].map((name) => name[1]));
  assert.equal(new Set(mapped).size, 15, 'Together the screens use all fifteen methods');
  for (const name of mapped) assert.ok(locked.includes(name), `${name} is a locked SDK method`);
  const writes = ['increasePosition', 'reducePosition', 'adjustPositionLeverage', 'depositAndMint', 'repayAndWithdraw', 'buildBridgeTx', 'getRedeemTx', 'depositFxSave', 'withdrawFxSave'];
  for (const name of locked) {
    const tag = board.match(new RegExp(`<li data-method="${name}"[^>]*>`))?.[0] ?? '';
    assert.equal(/data-write/.test(tag), writes.includes(name), `${name} write marking`);
  }
});

test('instruments are real controls only when script can drive them', () => {
  for (const control of ['.split-control', '.brake-picker', '.sdk-picker', '.sdk-status']) {
    assert.ok(css.includes(control), `${control} is styled`);
  }
  assert.match(css, /:root:not\(\[data-js\]\) :is\(\.split-control, \.brake-picker, \.sdk-picker, \.sdk-status\) \{ display: none; \}/);
  assert.match(css, /:root:not\(\[data-js\]\) \.sdk-group li \{ color: var\(--text\); \}/);
  // The peg bead is SMIL, started by script only while motion is welcome.
  assert.match(html, /<animateMotion [^>]*begin="indefinite"/);
  assert.match(script, /const run = pegOnScreen && !still\(\) && !document\.hidden;/);
});

test('markup and scripts fit the strict content security policy', () => {
  assert.doesNotMatch(html, /\sstyle=/, 'Inline style attributes are blocked by style-src');
  assert.doesNotMatch(html, /<style\b/, 'Style elements are blocked by style-src');
  assert.doesNotMatch(html, /\son[a-z]+=/i, 'Inline event handlers are blocked by script-src');
  // Exactly the two external scripts the page ships, and nothing inline.
  assert.equal(html.toLowerCase().split('<script').length - 1, 2, 'Only the two external scripts may appear');
  assert.ok(html.includes('<script src="script.js"></script>'), 'script.js loads as an external file');
  assert.ok(html.includes('<script src="aurora.js" defer></script>'), 'aurora.js loads as an external, deferred file');
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

test('motion is opt-in, and every loop stays in an ambient region', () => {
  const motion = cssBlock(css, '@media (prefers-reduced-motion: no-preference)');
  const outside = css.slice(0, motion.start) + css.slice(motion.end + 1);
  assert.doesNotMatch(outside.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ''), /\banimation\s*:/,
    'Animations must only be declared for visitors who have not asked for reduced motion');
  for (const rule of motion.body.match(/[^{}]+\{[^{}]*\binfinite\b[^{}]*\}/g) || []) {
    const selector = rule.slice(0, rule.indexOf('{'));
    assert.match(selector, /\[data-ambient\]|\.traveller-orbit/, `Looping animation outside an ambient region: ${selector.trim()}`);
  }
  assert.match(html, /<g class="traveller-orbit" data-ambient>/);
  assert.match(html, /<figure class="hero-stage"[^>]*data-ambient>/);
  assert.match(aurora, /prefers-reduced-motion: reduce/, 'The aurora holds one frame under reduced motion');
});

test('built output includes launcher, start links, QR code, scripts, and strict static headers', async () => {
  const launcher = telegramLauncher(process.env.NEXT_PUBLIC_TELEGRAM_APP_URL || undefined);
  assert.ok(builtHtml.includes(`href="${escapeAttribute(launcher)}"`));
  for (const route of ['trade', 'earn', 'borrow', 'move']) assert.ok(builtHtml.includes(`href="${escapeAttribute(telegramStartLink(launcher, route))}"`), `${route} start link`);
  assert.equal(await readFile(resolve(root, 'dist/assets/telegram-qr.svg'), 'utf8'), qrSvg(launcher), 'The QR code opens the same launcher');
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
  // Section links put their screen in the launcher's one start parameter.
  assert.equal(telegramStartLink(undefined, 'trade'), 'https://t.me/FxAeonBot?startapp=trade');
  assert.equal(telegramStartLink('https://t.me/FxAeonBot/app?startapp=launch_1', 'trade-btc'), 'https://t.me/FxAeonBot/app?startapp=trade-btc');
  for (const startParam of ['', 'Trade', 'trade/earn', 'trade?x=1', '../trade', 'trade earn', '"trade"', 'x'.repeat(33)]) {
    assert.throws(() => telegramStartLink(undefined, startParam), startParam);
  }
});

test('the Telegram QR code is the one qrcode.react draws, module for module', () => {
  // The launcher as the build draws it: level M, raised to Q or H when that is free.
  for (const launcher of [telegramLauncher(), 'https://t.me/FxAeonBot/app?startapp=launch_1']) {
    assert.deepEqual(qrModules(launcher), referenceQr(launcher, 'M', true), launcher);
  }
  // Every level across versions 1 to 10, then larger symbols at level M.
  const text = (length) => 'https://t.me/FxAeonBot?startapp=trade-btc&FxAeon/0123456789'.repeat(40).slice(0, length);
  for (const level of ['L', 'M', 'Q', 'H']) {
    for (let length = 1; ; length += 7) {
      const modules = qrModules(text(length), { level, boost: false });
      if (modules.length > 57) break;
      assert.deepEqual(modules, referenceQr(text(length), level, false), `${level}, ${length} bytes`);
    }
  }
  for (const length of [300, 700, 1200, 2300]) assert.deepEqual(qrModules(text(length), { boost: false }), referenceQr(text(length), 'M', false), `M, ${length} bytes`);
  // The asset draws exactly those modules inside a four-module quiet zone, with attributes only.
  const svg = qrSvg(telegramLauncher());
  const modules = qrModules(telegramLauncher());
  assert.match(svg, new RegExp(`^<svg xmlns="http://www\\.w3\\.org/2000/svg" viewBox="0 0 ${modules.length + 8} ${modules.length + 8}"`));
  assert.deepEqual(modulesFromPath(svg.match(/<path fill="#130e24" d="([^"]*)"/)[1], modules.length, 4), modules);
  assert.match(svg, new RegExp(`<rect width="${modules.length + 8}" height="${modules.length + 8}" fill="#ffffff"/>`));
  assert.doesNotMatch(svg, /<script|<style|\sstyle=|\son[a-z]+=|href=/i);
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

    // A named Mini App launcher with its own start parameter.
    const launcher = 'https://t.me/FxAeonBot/app?startapp=launch_1';
    execFileSync(process.execPath, ['build.mjs'], { cwd: tempLanding, stdio: 'pipe', env: { ...process.env, NEXT_PUBLIC_TELEGRAM_APP_URL: launcher } });

    await assert.rejects(access(resolve(tempRoot, 'node_modules')));
    await assert.rejects(access(resolve(tempLanding, 'node_modules')));
    for (const file of ['aurora.js', 'script.js', 'assets/icons/receive.svg', 'assets/icons/trade.svg', 'assets/icons/move.svg', 'assets/icons/earn.svg', 'assets/icons/LICENSE.txt', 'assets/telegram-qr.svg']) {
      await access(resolve(tempLanding, 'dist', file));
    }
    const built = await readFile(resolve(tempLanding, 'dist/index.html'), 'utf8');
    const destinations = [...built.matchAll(/href="(https:\/\/t\.me\/[^"]*)"/g)].map(([, href]) => href);
    assert.deepEqual([...new Set(destinations)].sort(), [
      'https://t.me/FxAeonBot/app?startapp=borrow', 'https://t.me/FxAeonBot/app?startapp=earn',
      'https://t.me/FxAeonBot/app?startapp=launch_1', 'https://t.me/FxAeonBot/app?startapp=move',
      'https://t.me/FxAeonBot/app?startapp=trade',
    ]);
    assert.equal(await readFile(resolve(tempLanding, 'dist/assets/telegram-qr.svg'), 'utf8'), qrSvg(launcher));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('checked-in icons match the app’s pinned Lucide renderer and license', async () => {
  const react = appRequire('react');
  const { renderToStaticMarkup } = appRequire('react-dom/server');
  const lucide = appRequire('lucide-react');
  const lucidePackagePath = appRequire.resolve('lucide-react/package.json');

  const icons = { receive: lucide.ArrowDownToLine, trade: lucide.CandlestickChart, move: lucide.ArrowLeftRight, earn: lucide.PiggyBank };
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

test('the build ships no asset that nothing references', async () => {
  const site = await Promise.all(['index.html', 'styles.css', 'script.js', 'aurora.js', '404.html', 'document.css']
    .map((file) => readFile(resolve(root, 'dist', file), 'utf8')));
  const shipped = (await readdir(resolve(root, 'dist/assets'), { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(resolve(root, 'dist'), resolve(entry.parentPath, entry.name)).split(sep).join('/'));
  assert.ok(shipped.length > 0);
  for (const file of shipped) {
    // License notices travel with the font and icons they cover.
    if (/LICENSE\.txt$/.test(file)) continue;
    assert.ok(site.some((source) => source.includes(file)), `${file} ships, but no page, style, script, or meta tag uses it`);
  }
  for (const removed of ['portfolio-preview.png', 'portfolio-mobile.png', 'fxaeon-sculpture.webp', 'icons/borrow.svg']) {
    await assert.rejects(access(resolve(root, 'assets', removed)), `assets/${removed} should stay out of the landing`);
  }
});
