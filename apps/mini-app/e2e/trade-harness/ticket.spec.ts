import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { debtShare } from '../../src/lib/leverageShare';

// The real Trade ticket (LeverageField and its split slider) over the offline
// RPC fixture used by the review preparation harness. No wallet connector,
// signature or live RPC is used.
const require = createRequire(resolve(__dirname, 'ticket.spec.ts'));
const { buildHarness } = require('./long-review-build.cjs') as { buildHarness: () => Promise<{ script: string; css: string }> };
const { createFixture } = require('./long-review-rpc.cjs') as { createFixture: (options: Record<string, unknown>) => { rpc: (request: unknown) => Promise<unknown> } };
let bundle: { script: string; css: string };
test.beforeAll(async () => { bundle = await buildHarness(); });

type Control = {
  wallet: { ready: boolean; authenticated: boolean; isEmbedded: boolean; address: string; chainId: number; connectionVersion: number };
  events: Array<{ name: string; start: number; end?: number; error?: string }>;
  trace: (name: string, fn: () => Promise<unknown>) => Promise<unknown>;
};
type Harness = typeof globalThis & { __longReview: Control };

async function mount(page: Page, options: { delayMs?: number; reducedMotion?: 'reduce' | 'no-preference' } = {}) {
  const fixture = createFixture({ delayMs: options.delayMs ?? 20, ethBalance: 400000000000000n });
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('/api/gas')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ source: 'etherscan', chainId: 1, gasPriceWei: '3000000000', baseFeePerGasWei: '1000000000', tiers: { standard: '3000000000', fast: '4000000000', rapid: '5000000000' }, fetchedAt: Date.now(), stale: false }) });
    if (url.includes('fake-controlled-fixture')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(await fixture.rpc(route.request().postDataJSON())) });
    }
    if (url.startsWith('http://long-review.test/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' });
    return route.abort();
  });
  await page.emulateMedia({ reducedMotion: options.reducedMotion ?? 'reduce' });
  await page.goto('http://long-review.test/trade');
  await page.evaluate(() => {
    (globalThis as unknown as { process: { env: Record<string, string> } }).process = { env: {} };
    const h: Control = {
      wallet: { ready: true, authenticated: true, isEmbedded: true, address: '0x1111111111111111111111111111111111111111', chainId: 1, connectionVersion: 1 },
      events: [],
      async trace(name, fn) {
        const event: Control['events'][number] = { name, start: performance.now() }; h.events.push(event);
        try { return await fn(); } catch (cause) { event.error = String(cause); throw cause; } finally { event.end = performance.now(); }
      },
    };
    (globalThis as Harness).__longReview = h;
  });
  await page.addStyleTag({ content: bundle.css });
  await page.addScriptTag({ content: bundle.script });
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (globalThis as Harness).__longReview.events.some((event) => event.name === 'readLeverageBounds' && event.end !== undefined))).toBe(true);
}
const slider = (page: Page) => page.getByRole('slider', { name: 'Target leverage slider', exact: true });
const leverageField = (page: Page) => page.getByRole('spinbutton', { name: 'Target leverage', exact: true });

/** The drawn bar and thumb, and the screen x of a share along the bar. */
async function track(page: Page) {
  const root = slider(page).locator('..');
  const bar = (await root.locator('div[aria-hidden="true"]').boundingBox())!;
  const thumb = root.locator('span[aria-hidden="true"]');
  return { bar, thumb, y: bar.y + bar.height / 2, at: (share: number) => bar.x + share * bar.width };
}
async function thumbCentre(thumb: Locator) {
  const box = (await thumb.boundingBox())!;
  return box.x + box.width / 2;
}

test.describe('the leverage slider is the debt/your-share split', () => {
  test('its thumb sits at the debt share, and the split it draws follows every move', async ({ page }) => {
    await mount(page);
    for (const leverage of ['2', '3.5', '1.5']) {
      await leverageField(page).fill(leverage);
      const { at, thumb } = await track(page);
      expect(Math.abs(await thumbCentre(thumb) - at(debtShare('long', Number(leverage))))).toBeLessThanOrEqual(1);
    }
    await page.getByRole('radio', { name: 'Short' }).click();
    await leverageField(page).fill('3');
    const short = await track(page);
    expect(Math.abs(await thumbCentre(short.thumb) - short.at(debtShare('short', 3)))).toBeLessThanOrEqual(1);
    await expect(slider(page)).toHaveAttribute('aria-valuetext', '3.0×, 75% borrowed wstETH');
  });

  test('a mouse drag maps x to the share drawn under it, snapped to 0.1×, and the ends clamp to the range', async ({ page }) => {
    await mount(page);
    const min = Number(await slider(page).getAttribute('min'));
    const max = Number(await slider(page).getAttribute('max'));
    const { at, y, thumb } = await track(page);
    // Grabbing the thumb off-centre does not jump it.
    await page.mouse.move(await thumbCentre(thumb) + 5, y);
    await page.mouse.down();
    await expect(leverageField(page)).toHaveValue('2');
    await page.mouse.move(at(debtShare('long', 3.5)) + 5, y, { steps: 6 });
    await expect(leverageField(page)).toHaveValue('3.5');
    await page.mouse.move(at(0.995), y, { steps: 4 });
    await expect(leverageField(page)).toHaveValue(String(max));
    await page.mouse.move(at(0.005), y, { steps: 8 });
    await expect(leverageField(page)).toHaveValue(String(min));
    await page.mouse.up();
    // A click on the track moves the thumb there, as on a native slider.
    await page.mouse.click(at(debtShare('long', 4)), y);
    await expect(leverageField(page)).toHaveValue('4');
    await expect(slider(page)).toHaveValue('4');
    await expect(slider(page)).toBeFocused();
  });

  test('keys step 0.1×, pages move a whole ×, and Home/End reach the bounds', async ({ page }) => {
    await mount(page);
    const min = await slider(page).getAttribute('min');
    const max = await slider(page).getAttribute('max');
    await leverageField(page).fill('2');
    await slider(page).focus();
    for (const [key, value] of [['ArrowRight', '2.1'], ['ArrowUp', '2.2'], ['ArrowLeft', '2.1'], ['PageUp', '3.1'], ['PageUp', '4.1'], ['PageDown', '3.1'], ['Home', min], ['End', max], ['PageUp', max]] as const) {
      await slider(page).press(key);
      await expect(slider(page)).toHaveValue(value!);
      await expect(leverageField(page)).toHaveValue(value!);
    }
  });

  test('assistive technology hears a slider in leverage units, with the split it draws', async ({ page }) => {
    await mount(page);
    await leverageField(page).fill('2.8');
    const cdp = await page.context().newCDPSession(page);
    type AXNode = { role?: { value?: string }; name?: { value?: string }; value?: { value?: unknown }; properties?: Array<{ name: string; value: { value?: unknown } }> };
    const { nodes } = await cdp.send('Accessibility.getFullAXTree') as unknown as { nodes: AXNode[] };
    const sliders = nodes.filter((node) => node.role?.value === 'slider');
    expect(sliders.map((node) => node.name?.value)).toEqual(['Target leverage slider']);
    // Chromium reports the accessible value and bounds as float32: leverage, not share.
    const properties = Object.fromEntries((sliders[0].properties ?? []).map((property) => [property.name, Number(property.value.value)]));
    expect(Number(sliders[0].value?.value)).toBeCloseTo(2.8, 5);
    expect(properties.valuemin).toBeCloseTo(Number(await slider(page).getAttribute('min')), 5);
    expect(properties.valuemax).toBeCloseTo(Number(await slider(page).getAttribute('max')), 5);
    // CDP's tree does not carry aria-valuetext (it reads empty even on a role="slider"); the attribute is what screen readers speak.
    await expect(slider(page)).toHaveAttribute('aria-valuetext', '2.8×, 64% minted fxUSD');
    await page.getByRole('radio', { name: 'Short' }).click();
    await leverageField(page).fill('3');
    await expect(slider(page)).toHaveAttribute('aria-valuetext', '3.0×, 75% borrowed wstETH');
  });

  test.describe('on a touch screen', () => {
    test.use({ hasTouch: true });

    test('a sideways drag moves the thumb with the finger, a tap jumps it, and a vertical swipe leaves it alone', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 700 });
      await mount(page);
      await leverageField(page).fill('2');
      const touch = await page.context().newCDPSession(page);
      const { at, y, thumb } = await track(page);
      const start = await thumbCentre(thumb);
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start, y }] });
      for (const share of [0.55, 0.6, debtShare('long', 3)]) {
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: at(share), y }] });
      }
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(leverageField(page)).toHaveValue('3');

      await page.touchscreen.tap(at(debtShare('long', 1.5)), y);
      await expect(leverageField(page)).toHaveValue('1.5');

      // Scrolling past the ticket is not a leverage change.
      const target = at(debtShare('long', 4));
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: target, y }] });
      for (const dy of [12, 30, 60]) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: target + 2, y: y - dy }] });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(leverageField(page)).toHaveValue('1.5');
    });
  });

  test('the boundary glides to a typed leverage unless reduced motion is asked for', async ({ page }) => {
    await mount(page, { reducedMotion: 'no-preference' });
    const thumb = slider(page).locator('..').locator('span[aria-hidden="true"]');
    expect(await thumb.evaluate((element) => getComputedStyle(element).transitionProperty)).toContain('left');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // The app's reduced-motion reset leaves transitions at 0.01ms: instant, never a glide.
    expect(await thumb.evaluate((element) => getComputedStyle(element).transitionDuration.split(',').every((duration) => parseFloat(duration) < 0.001))).toBe(true);
  });
});
