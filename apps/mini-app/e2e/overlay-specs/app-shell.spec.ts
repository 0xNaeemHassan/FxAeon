import { expect, test, type Page } from '@playwright/test';
import { buildAppShellLab, LAB_ORIGIN, serveAppShellLab } from '../harness/app-shell-build';

type Lab = Awaited<ReturnType<typeof buildAppShellLab>>;
type WalletPatch = { ready?: boolean; authenticated?: boolean; address?: string; chainId?: number; ensName?: string };

const ADDRESS = '0x1d34A0000000000000000000000000000000AF81';
const WIDTHS = [320, 344, 360, 375, 390, 412, 430, 480];
const STATES: Array<[string, WalletPatch]> = [
  ['loading', { ready: false, authenticated: false, address: undefined, chainId: undefined }],
  ['disconnected', { ready: true, authenticated: false, address: undefined, chainId: undefined }],
  ['connected', { ready: true, authenticated: true, address: ADDRESS, chainId: 1 }],
];

let lab: Lab;
test.beforeAll(async () => { lab = await buildAppShellLab(); });

async function open(page: Page, { width = 390, height = 844, initScript = '' } = {}) {
  await page.setViewportSize({ width, height });
  await serveAppShellLab(page, lab, initScript);
  await page.goto(`${LAB_ORIGIN}/`);
  await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
}

async function setLab(page: Page, patch: Record<string, unknown>) {
  await page.evaluate((value) => (globalThis as typeof globalThis & { __shellLab: { set: (patch: unknown) => void } }).__shellLab.set(value), patch);
}

async function headerGeometry(page: Page) {
  return page.locator('header.app-topbar').evaluate((topbar) => {
    const group = topbar.querySelector('[data-header-wallet-control]')!.getBoundingClientRect();
    const name = topbar.querySelector<HTMLElement>('[data-wallet-identity-name]');
    const controls = [...topbar.querySelectorAll<HTMLElement>('.app-topbar-actions button')].map((control) => control.getBoundingClientRect());
    return {
      height: topbar.getBoundingClientRect().height,
      overflow: topbar.scrollWidth - topbar.clientWidth,
      groupLeft: group.left,
      groupRight: group.right,
      nameClipped: name ? name.scrollWidth > name.clientWidth : false,
      smallestControl: Math.min(...controls.map((rect) => Math.min(rect.width, rect.height))),
      viewport: window.innerWidth,
    };
  });
}

test('the header stays one row with one footprint while the wallet settles, at every phone width', async ({ page }) => {
  await open(page);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    const lefts: number[] = [];
    for (const [state, wallet] of STATES) {
      await setLab(page, { wallet });
      const geometry = await headerGeometry(page);
      expect(geometry.height, `${state} header is one 48px row at ${width}px`).toBeLessThanOrEqual(48);
      expect(geometry.overflow, `${state} header overflows at ${width}px`).toBeLessThanOrEqual(0);
      expect(geometry.groupRight, `${state} controls stay on screen at ${width}px`).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.smallestControl, `${state} controls keep 44px targets at ${width}px`).toBeGreaterThanOrEqual(44);
      expect(geometry.nameClipped, `the compact address is shown whole at ${width}px`).toBe(false);
      lefts.push(geometry.groupLeft);
    }
    // On phones the network control never moves when the wallet settles.
    if (width <= 430) expect(Math.max(...lefts) - Math.min(...lefts), `wallet controls jump at ${width}px`).toBeLessThanOrEqual(1);
  }
});

test('an ENS-length name never breaks the header into two rows', async ({ page }) => {
  await open(page);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    await setLab(page, { wallet: { ready: true, authenticated: true, address: ADDRESS, chainId: 1, ensName: 'dextrader-2024.eth' } });
    const geometry = await headerGeometry(page);
    expect(geometry.height, `header is one row at ${width}px`).toBeLessThanOrEqual(48);
    expect(geometry.overflow, `header overflows at ${width}px`).toBeLessThanOrEqual(0);
    expect(geometry.smallestControl).toBeGreaterThanOrEqual(44);
  }
});

test('loading shows placeholders, not a globe or an empty pill, and they settle after a timeout', async ({ page }) => {
  await open(page);
  // Restart the provider wait with a short timeout (the real one is 12s).
  await setLab(page, { readyTimeoutMs: 400, wallet: STATES[2][1] });
  await setLab(page, { wallet: STATES[0][1] });
  const group = page.getByRole('group', { name: 'Wallet and network controls' });
  await expect(group.locator('.network-selector-placeholder')).toBeVisible();
  await expect(group.locator('img')).toHaveCount(0);
  const placeholder = group.getByRole('status');
  await expect(placeholder).toHaveText('Loading wallet');
  expect(await placeholder.locator('[aria-hidden="true"]').first().evaluate((element) => getComputedStyle(element).animationName)).not.toBe('none');

  await expect(placeholder).toHaveText('Wallet unavailable');
  await expect(placeholder).toHaveAttribute('data-settled', 'true');
  expect(await placeholder.locator('[aria-hidden="true"]').first().evaluate((element) => getComputedStyle(element).animationName)).toBe('none');

  await setLab(page, { wallet: STATES[1][1] });
  await expect(group.getByRole('button', { name: 'Connect wallet' })).toBeVisible();
  await expect(group.locator('.network-selector-chains img')).toHaveCount(2);
  await expect(group.locator('.network-selector')).toHaveAttribute('aria-label', 'Choose a network or connect a wallet');

  await setLab(page, { wallet: STATES[2][1] });
  await expect(group.getByRole('button', { name: 'Open wallet profile' })).toContainText('0x1d34…AF81');
  await expect(group.locator('.network-selector img')).toHaveCount(1);
  await expect(group.locator('.network-selector')).toHaveAttribute('aria-label', 'Change network, current Ethereum');
});

test('the theme control shows the theme in use and names the one it switches to', async ({ page }) => {
  await open(page);
  await setLab(page, { wallet: STATES[2][1] });
  const expectations = [
    { theme: 'official', name: 'Official theme. Switch to dark theme' },
    { theme: 'dark', name: 'Dark theme. Switch to light theme' },
    { theme: 'light', name: 'Light theme. Switch to official theme' },
  ];
  for (const [index, { theme, name }] of expectations.entries()) {
    const toggle = page.getByRole('button', { name, exact: true });
    await expect(toggle).toBeEnabled();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const visible = await toggle.locator('[data-theme-icon]').evaluateAll((icons) => icons
      .filter((icon) => getComputedStyle(icon).display !== 'none')
      .map((icon) => icon.getAttribute('data-theme-icon')));
    expect(visible).toEqual([theme]);
    if (index < expectations.length - 1) await toggle.click();
  }
});

test('the theme icon follows the pre-hydration theme, so a saved theme never flashes the default icon', async ({ page }) => {
  await open(page, { initScript: "localStorage.setItem('fxaeon_theme_id_v2','dark')" });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const visibleIcons = () => page.locator('.theme-toggle [data-theme-icon]').evaluateAll((elements) => elements
    .filter((icon) => getComputedStyle(icon).display !== 'none')
    .map((icon) => icon.getAttribute('data-theme-icon')));
  expect(await visibleIcons()).toEqual(['dark']);
  // Server HTML renders React's default state; the root attribute alone must pick the icon.
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  expect(await visibleIcons()).toEqual(['light']);
});

test('the dock names Portfolio, matching its page, and every label fits a 320px dock in each theme', async ({ page }) => {
  await open(page, { width: 320, height: 700 });
  await setLab(page, { wallet: STATES[2][1] });
  const nav = page.locator('nav.mobile-tabbar');
  await expect(nav.getByRole('link', { name: 'Portfolio', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1, name: 'Portfolio' })).toBeVisible();
  for (const theme of ['official', 'dark', 'light']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    const fits = await nav.locator('.nav-item-mobile').evaluateAll((items) => items.map((item) => {
      const label = item.querySelector<HTMLElement>('.nav-label')!;
      const range = document.createRange();
      range.selectNodeContents(label);
      const text = range.getBoundingClientRect();
      const box = item.getBoundingClientRect();
      return { label: label.textContent, spare: box.width - text.width, height: box.height, width: box.width, lines: range.getClientRects().length };
    }));
    for (const item of fits) {
      expect(item.spare, `${item.label} needs breathing room in the ${theme} dock`).toBeGreaterThanOrEqual(8);
      expect(item.lines, `${item.label} stays on one line`).toBe(1);
      expect(Math.min(item.width, item.height)).toBeGreaterThanOrEqual(44);
    }
  }
});
