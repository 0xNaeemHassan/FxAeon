import playwright from '../apps/mini-app/node_modules/@playwright/test/index.js';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.env.FX_SCREENSHOT_OUTPUT_DIR || path.join(root, 'docs', 'assets'));
const baseUrl = validateBaseUrl(process.env.FX_SCREENSHOT_BASE_URL ?? 'http://localhost:4321');
const captureProfile = process.env.FX_SCREENSHOT_CAPTURE_PROFILE?.trim() || 'standard';
const marketDataMode = process.env.FX_SCREENSHOT_MARKET_DATA?.trim() || 'live';
if (!['standard', 'positions', 'audit'].includes(captureProfile)) throw new Error('FX_SCREENSHOT_CAPTURE_PROFILE must be standard, positions, or audit');
if (!['live', 'fixture'].includes(marketDataMode)) throw new Error('FX_SCREENSHOT_MARKET_DATA must be live or fixture');
const captures = [];
const discoveryErrors = [];
const interceptedGroups = new Set();
const pageErrors = [];
const graphPrefix = '/api/public/project_cmgz5g9sl0065xhp2aqd9c6sv/subgraphs/';
const expectedPools = {
  'ETH:long': ['0x6ecfa38fee8a5277b91efda204c235814f0122e8', 'fx-v2-wsteth/3.0.0'],
  'ETH:short': ['0x25707b9e6690b52c60ae6744d711cf9c1dfc1876', 'fx-v2-wsteth-short/v0.1.0'],
  'BTC:long': ['0xab709e26fa6b0a30c119d8c55b887ded24952473', 'fx-v2-wbtc/3.0.0'],
  'BTC:short': ['0xa0cc8162c523998856d59065faa254f87d20a5b0', 'fx-v2-wbtc-short/v2.0.0'],
};
const positionManifest = loadPositionManifest(process.env.FX_SCREENSHOT_POSITION_MANIFEST);
if (captureProfile === 'positions' && !positionManifest) throw new Error('the positions capture profile requires FX_SCREENSHOT_POSITION_MANIFEST');

function validateBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || !url.port || Number(url.port) < 1024) throw new Error('capture base URL must be a credential-free localhost HTTP origin with an unprivileged port');
  return url.origin;
}

function loadPositionManifest(configuredPath) {
  if (!configuredPath) return undefined;
  const manifest = JSON.parse(readFileSync(path.resolve(configuredPath), 'utf8'));
  if (
    manifest?.proof !== 'fxaeon-position-screenshot-fixture'
    || manifest?.schemaVersion !== 1
    || manifest?.chainId !== 1
    || !Number.isSafeInteger(manifest?.forkBlock) || manifest.forkBlock <= 0
    || (manifest.executionSurface !== undefined && !['browser', 'node-runner'].includes(manifest.executionSurface))
    || !/^0x[0-9a-f]{40}$/i.test(manifest?.wallet ?? '')
    || !Array.isArray(manifest?.positions)
    || manifest.positions.length !== 4
  ) throw new Error('FX_SCREENSHOT_POSITION_MANIFEST is not a complete four-position fixture');
  const seenGroups = new Set();
  for (const position of manifest.positions) {
    // These URLs and pool mappings come from the pinned SDK, not arbitrary
    // manifest input. A swapped or duplicate group must fail the capture.
    const group = `${position?.market}:${position?.side}`;
    const expected = expectedPools[group];
    if (
      !expected
      || seenGroups.has(group)
      || !Number.isSafeInteger(position?.positionId)
      || position.positionId <= 0
      || position?.pool?.toLowerCase() !== expected[0]
      || position?.graphSubgraph !== expected[1]
      || !/^\d+$/.test(position?.rawCollateral ?? '') || BigInt(position.rawCollateral) <= 0n
      || !/^\d+$/.test(position?.rawDebt ?? '') || BigInt(position.rawDebt) <= 0n
    ) throw new Error('FX_SCREENSHOT_POSITION_MANIFEST contains an invalid position row');
    seenGroups.add(group);
  }
  return manifest;
}

mkdirSync(output, { recursive: true });
const browser = await playwright.chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function createCaptureContext({ viewport, theme }) {
  const colorScheme = theme === 'light' ? 'light' : 'dark';
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme,
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  context.on('page', (page) => page.on('pageerror', (error) => pageErrors.push(error.message)));

  if (positionManifest) {
    // Reuse either a screenshot build or the browser acceptance build while
    // its fork is still alive. Reads use the application's configured client;
    // this injected identity has no RPC forwarding or signing capability.
    // Raw content avoids transpiler helpers in serialized browser functions.
    await context.addInitScript({ content: `
      Object.defineProperty(window, 'ethereum', {
        configurable: true,
        value: Object.freeze({
          async request(request) {
            if (request.method === 'eth_accounts' || request.method === 'eth_requestAccounts') {
              return [${JSON.stringify(positionManifest.wallet)}];
            }
            if (request.method === 'eth_chainId') return '0x1';
            throw new Error('Documentation fork wallet is read-only.');
          },
          on() {},
          removeListener() {}
        })
      });
    ` });
  }

  await context.addInitScript(({ themeId, origin }) => {
    // Playwright also installs this on initial about:blank and child frames.
    // Only this application's origin has storage relevant to its theme.
    if (window.location.origin !== origin) return;
    window.localStorage.setItem('fxaeon_theme_id_v2', themeId);
    window.localStorage.setItem('fxaeon.settings.v1', JSON.stringify({ theme: themeId }));
  }, { themeId: theme, origin: baseUrl });

  await context.route('**/telegram-web-app.js', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: '/* documentation capture: plain browser */',
  }));

  if (marketDataMode === 'fixture') {
    // Deliberately synthetic, opt-in design data. Every captured frame is
    // visibly labelled and its report records this mode. Never use as proof
    // of prices, returns, oracle values, execution quotes, or protocol state.
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

  await context.route('https://api.coingecko.com/**', async (route) => {
    const url = new URL(route.request().url());
    const marketId = url.pathname.match(/\/coins\/([^/]+)\/market_chart$/)?.[1];
    if (marketId !== 'ethereum' && marketId !== 'bitcoin') return route.abort('blockedbyclient');
    const days = Math.max(1, Math.min(30, Number(url.searchParams.get('days')) || 1));
    const count = 120;
    const end = Date.now();
    const start = end - days * 24 * 60 * 60 * 1_000;
    const basePrice = marketId === 'bitcoin' ? 104_240 : 2_485.42;
    const prices = Array.from({ length: count }, (_, index) => {
      const progress = index / (count - 1);
      const timestamp = Math.round(start + progress * (end - start));
      const trend = 0.972 + progress * 0.028;
      const wave = Math.sin(index / 7) * 0.0035;
      return [timestamp, Number((basePrice * (trend + wave)).toFixed(6))];
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ prices }) });
  });
  }

  if (positionManifest) {
    // The local fork creates valid position NFTs, but a fork-local block can
    // never be indexed by Goldsky. Intercept only this discovery query; the
    // official SDK still resolves collateral, debt, leverage, and pool state
    // against the contracts on Anvil. The fixture verifies NFT ownership.
    await context.route('https://api.goldsky.com/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const position = positionManifest.positions.find((candidate) => url.pathname === `${graphPrefix}${candidate.graphSubgraph}/gn`);
      let matchesDiscovery = false;
      try {
        const payload = request.postDataJSON();
        const normalise = (query) => query.replace(/\s/g, '');
        const expectedQuery = `query MyQuery { positions(first: 1000 where: {owner: "${positionManifest.wallet.toLowerCase()}"} orderBy: blockNumber orderDirection: desc) { id } }`;
        matchesDiscovery = request.method() === 'POST' && !url.search && !url.hash
          && typeof payload?.query === 'string' && Object.keys(payload).length === 1
          && normalise(payload.query) === normalise(expectedQuery);
      } catch {
        // Malformed or expanded queries must never become silent empty data.
      }
      if (!position || !matchesDiscovery) {
        discoveryErrors.push('Unexpected Goldsky request; only the four exact owner-ID discovery queries may be intercepted');
        return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ errors: [{ message: 'Unexpected screenshot discovery request' }] }) });
      }
      interceptedGroups.add(`${position.market}:${position.side}`);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { positions: [{ id: String(position.positionId) }] } }),
      });
    });
  }

  return context;
}

async function readCaptureViewport(page, session) {
  const dom = await page.evaluate(() => {
    const offset = (element) => ({ x: element?.scrollLeft ?? 0, y: element?.scrollTop ?? 0 });
    const rect = (selector) => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return box && box.width > 0 && box.height > 0
        ? { top: box.top, right: box.right, bottom: box.bottom, left: box.left }
        : null;
    };
    return {
      window: { x: window.scrollX, y: window.scrollY },
      document: offset(document.scrollingElement),
      body: offset(document.body),
      containers: ['.app-shell', '.app-workspace', '.app-content'].map((selector) => ({ selector, ...offset(document.querySelector(selector)) })),
      visual: { x: window.visualViewport?.pageLeft ?? window.scrollX, y: window.visualViewport?.pageTop ?? window.scrollY },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      topbar: rect('.app-topbar'),
      rail: rect('.desktop-rail'),
    };
  });
  // Chromium's screenshot clip uses this viewport, so document.scrollTop alone
  // is not enough to prove that the exported frame starts at the page origin.
  const metrics = await session.send('Page.getLayoutMetrics');
  return {
    ...dom,
    browserLayout: { x: metrics.cssLayoutViewport.pageX, y: metrics.cssLayoutViewport.pageY },
    browserVisual: { x: metrics.visualViewport.pageX, y: metrics.visualViewport.pageY },
  };
}

function assertCaptureViewport(state, stage) {
  const offsets = [state.window, state.document, state.body, state.visual, state.browserLayout, state.browserVisual, ...state.containers];
  const atOrigin = offsets.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 0.5 && Math.abs(y) <= 0.5);
  const chromeVisible = [state.topbar, state.rail].filter(Boolean).every((box) => (
    box.top >= -0.5 && box.left >= -0.5
    && box.bottom <= state.viewport.height + 0.5 && box.right <= state.viewport.width + 0.5
  ));
  if (!atOrigin || !chromeVisible) throw new Error(`capture viewport moved ${stage}: ${JSON.stringify(state)}`);
}

async function waitForStandardLogin(page) {
  // Login's SSR/hydration fallback is itself a visible <main>. Wait for the
  // actual browser-wallet screen, not merely the generic page landmark.
  await page.locator('main.auth-shell').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByRole('heading', { name: 'Connect your wallet', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  const connect = page.getByRole('button', { name: 'Connect browser wallet', exact: true });
  await playwright.expect(connect).toBeVisible({ timeout: 30_000 });
  await playwright.expect(connect).toBeEnabled({ timeout: 30_000 });
  await page.locator('.loading-line').waitFor({ state: 'hidden', timeout: 30_000 });
}

async function capture(page, file, route, prepare) {
  const response = await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' });
  if (!response?.ok()) throw new Error(`capture route ${route} did not return a successful response`);
  await page.locator('main').last().waitFor({ state: 'visible' });
  await prepare?.(page);
  // Lazy wallet/settings modules can still be hydrating after the page
  // landmark appears. Do not publish an empty placeholder as a finished UI.
  await playwright.expect(page.locator('.loading-line')).toHaveCount(0, { timeout: 30_000 });
  if (route === '/settings') {
    await playwright.expect(page.getByText('Wallet', { exact: true })).toBeVisible();
    await playwright.expect(page.locator('.skeleton')).toHaveCount(0, { timeout: 30_000 });
  }
  await page.waitForFunction(() => !document.querySelector('[aria-label="Loading market chart"]'), null, { timeout: 60_000 });
  await page.waitForFunction(() => [...document.images]
    .filter((image) => {
      const rect = image.getBoundingClientRect();
      const style = window.getComputedStyle(image);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.right > 0
        && rect.top < window.innerHeight
        && rect.left < window.innerWidth;
    })
    .every((image) => image.complete && image.naturalWidth > 0), null, { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  if (discoveryErrors.length || pageErrors.length) throw new Error(`capture rejected: ${[...discoveryErrors, ...pageErrors].join('; ')}`);
  if (positionManifest && interceptedGroups.size !== 4) throw new Error('all four exact SDK discovery requests must be observed before capture');
  if (marketDataMode === 'fixture' || positionManifest) {
    await page.evaluate(({ illustrative, fork }) => {
      const caption = document.createElement('aside');
      caption.textContent = [fork ? 'Local Ethereum fork' : 'Documentation preview', illustrative ? 'Illustrative prices & charts' : 'Display prices observed at capture'].join(' · ');
      caption.setAttribute('data-capture-provenance', 'true');
      Object.assign(caption.style, { position: 'fixed', top: '4px', left: '50%', transform: 'translateX(-50%)', zIndex: '2147483647', whiteSpace: 'nowrap', maxWidth: '98vw', padding: '3px 8px', borderRadius: '4px', background: '#111827', color: '#f9fafb', font: '9px/1.4 system-ui', pointerEvents: 'none' });
      document.body.appendChild(caption);
    }, { illustrative: marketDataMode === 'fixture', fork: Boolean(positionManifest) });
  }
  const renderedPositionKeys = await page.locator('[data-position-key]').evaluateAll((cards) => [...new Set(cards.map((card) => card.getAttribute('data-position-key')))].sort());
  const session = await page.context().newCDPSession(page);
  try {
    if (captureProfile === 'standard' && route === '/login') await waitForStandardLogin(page);
    await page.evaluate(async () => {
      // Preparation can leave an offscreen editable focused. Remove that
      // selection/focus anchor before the screenshot changes caret styling.
      // Do not reset nested token-list scroll or otherwise change the layout.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      document.scrollingElement?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    });
    const before = await readCaptureViewport(page, session);
    assertCaptureViewport(before, 'before screenshot');
    const buffer = await page.screenshot({ fullPage: false, animations: 'disabled', caret: 'hide' });
    const after = await readCaptureViewport(page, session);
    assertCaptureViewport(after, 'after screenshot');
    if (captureProfile === 'standard' && route === '/login') {
      await playwright.expect(page.getByRole('heading', { name: 'Connect your wallet', exact: true })).toBeVisible();
      await playwright.expect(page.getByRole('button', { name: 'Connect browser wallet', exact: true })).toBeVisible();
      await playwright.expect(page.locator('.loading-line')).toHaveCount(0);
    }
    for (const key of ['topbar', 'rail']) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) throw new Error(`capture chrome shifted during screenshot: ${key}`);
    }
    // Publish the frame only after both DOM and Chromium offsets are checked.
    writeFileSync(path.join(output, file), buffer);
    captures.push({ file, route, viewport: page.viewportSize(), renderedPositionKeys, scrollEvidence: { before, after }, sha256: createHash('sha256').update(buffer).digest('hex') });
  } finally {
    await session.detach();
  }
}

async function waitForPositionKeys(page, expectedPositions) {
  const expectedKeys = expectedPositions.map((position) => `${position.market}:${position.side}:${position.positionId}`).sort();
  await page.waitForFunction((keys) => {
    const rendered = [...new Set([...document.querySelectorAll('[data-position-key]')].map((card) => card.getAttribute('data-position-key')))].sort();
    return JSON.stringify(rendered) === JSON.stringify(keys)
      && !document.querySelector('[aria-label="Loading positions"]')
      && !document.body.textContent.includes('Last verified')
      && !document.body.textContent.includes('Live verification failed');
  }, expectedKeys, { timeout: 120_000 });
}

async function waitForPopulatedPositions(page) {
  await waitForPositionKeys(page, positionManifest.positions);
}

async function waitForPopulatedPortfolio(page) {
  await waitForPositionKeys(page, positionManifest.positions.filter((position) => position.market === 'ETH'));
  await page.waitForFunction(() => {
    const metricShowsFour = [...document.querySelectorAll('.portfolio-value-metrics span')].some((metric) => (
      metric.querySelector('small')?.textContent?.trim() === 'Open positions'
      && metric.querySelector('strong')?.textContent?.trim() === '4'
    ));
    return metricShowsFour && !document.querySelector('[aria-label="Loading wallet balances"]');
  }, null, { timeout: 120_000 });
}

async function waitForPopulatedTrade(page) {
  await waitForPositionKeys(page, positionManifest.positions.filter((position) => position.market === 'ETH'));
}

async function main() {
  if (captureProfile === 'audit') {
    // A local-only visual contact set. No fixture wallet or market values are
    // necessary: disconnected and unavailable states must be designed too.
    const routes = ['/', '/login', '/portfolio', '/trade', '/positions', '/earn', '/borrow', '/move', '/more', '/settings', '/activity', '/qr', '/docs'];
    for (const theme of ['official', 'dark', 'light']) {
      for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
        const context = await createCaptureContext({ viewport, theme });
        const page = await context.newPage();
        for (const route of routes) {
          const name = route === '/' ? 'welcome' : route.slice(1);
          await capture(page, `audit-${name}-${theme}-${viewport.width}.png`, route, route === '/login' ? waitForStandardLogin : undefined);
        }
        await context.close();
      }
    }
    return;
  }
  if (captureProfile === 'positions') {
    const desktopContext = await createCaptureContext({ viewport: { width: 1180, height: 900 }, theme: 'official' });
    const desktopPage = await desktopContext.newPage();
    await capture(desktopPage, 'fxaeon-portfolio-positions.png', '/portfolio', waitForPopulatedPortfolio);
    await capture(desktopPage, 'fxaeon-positions.png', '/positions', waitForPopulatedPositions);
    await capture(desktopPage, 'fxaeon-trade-connected.png', '/trade', async (current) => {
      await waitForPopulatedTrade(current);
      await current.getByLabel('Amount in ETH').fill('1.25');
    });
    await desktopContext.close();

    const mobileContext = await createCaptureContext({ viewport: { width: 390, height: 844 }, theme: 'official' });
    const mobilePage = await mobileContext.newPage();
    await capture(mobilePage, 'fxaeon-positions-mobile.png', '/positions', waitForPopulatedPositions);
    await mobileContext.close();
    return;
  }

  const desktopContext = await createCaptureContext({ viewport: { width: 1440, height: 900 }, theme: 'official' });
  const desktopPage = await desktopContext.newPage();

  await capture(desktopPage, 'fxaeon-web.png', '/');
  await capture(desktopPage, 'fxaeon-trade.png', '/trade', async (current) => {
    await current.getByLabel('Amount in ETH').fill('1.25');
  });
  await capture(desktopPage, 'fxaeon-token-picker.png', '/trade', async (current) => {
    await current.getByLabel('Amount in ETH').fill('1.25');
    await current.getByLabel('Input asset').click();
    const picker = current.getByRole('dialog', { name: 'Input asset' });
    await picker.waitFor({ state: 'visible' });
    await current.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] img')].every((image) => image.complete && image.naturalWidth > 0), null, { timeout: 15_000 });
  });
  await capture(desktopPage, 'fxaeon-bridge.png', '/move');
  await capture(desktopPage, 'fxaeon-login.png', '/login', waitForStandardLogin);
  await capture(desktopPage, 'fxaeon-portfolio.png', '/portfolio');
  await capture(desktopPage, 'fxaeon-docs.png', '/docs');
  await desktopContext.close();

  const mobileTradeContext = await createCaptureContext({ viewport: { width: 390, height: 844 }, theme: 'official' });
  const mobileTradePage = await mobileTradeContext.newPage();
  await capture(mobileTradePage, 'fxaeon-trade-mobile.png', '/trade', async (current) => {
    await current.getByLabel('Amount in ETH').fill('1.25');
  });
  await mobileTradeContext.close();

  const mobilePortfolioContext = await createCaptureContext({ viewport: { width: 390, height: 844 }, theme: 'light' });
  const mobilePortfolioPage = await mobilePortfolioContext.newPage();
  await capture(mobilePortfolioPage, 'fxaeon-portfolio-mobile.png', '/portfolio');
  await mobilePortfolioContext.close();

}

try {
  await main();
  const report = {
    schemaVersion: 1,
    profile: captureProfile,
    capturedAt: new Date().toISOString(),
    marketData: marketDataMode === 'fixture' ? 'illustrative-display-fixture-visibly-labelled' : 'external-display-data-unmodified',
    positionDiscovery: positionManifest ? 'exact-four-sdk-owner-id-queries-only' : 'not-intercepted',
    positionFixtureExecutionSurface: positionManifest?.executionSurface ?? 'unspecified',
    observedDiscoveryGroups: [...interceptedGroups].sort(),
    discoveryErrors,
    captures,
    scope: 'Rendered documentation states, not browser transaction-execution proof.',
  };
  if (process.env.FX_SCREENSHOT_CAPTURE_REPORT) writeFileSync(path.resolve(process.env.FX_SCREENSHOT_CAPTURE_REPORT), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`Captured ${captures.length} documentation screens (${marketDataMode} display data)\n`);
} finally {
  await browser.close();
}
