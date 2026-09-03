import { expect, test, assertNoBackendRequests } from '../fixtures/test';

test.describe('cohesive responsive design', () => {
  test.use({ telegram: false });

  test('More theme choices persist and all route surfaces inherit the selected palette', async ({ page, requests }) => {
    test.setTimeout(90_000);
    await page.goto('/more', { waitUntil: 'domcontentloaded' });
    for (const theme of ['light', 'dark'] as const) {
      await page.getByRole('radio', { name: new RegExp(`Official ${theme}`) }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      for (const route of ['/trade', '/positions', '/portfolio', '/earn', '/borrow', '/move', '/activity', '/settings', '/qr', '/docs']) {
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('main:visible')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const mismatches = await page.locator('main:visible').evaluate((main) => {
          const root = getComputedStyle(document.documentElement);
          return [main, ...main.querySelectorAll('.ui-card, .amount-control, .market-chart-panel')].flatMap((element) => {
            const style = getComputedStyle(element);
            return ['--mint', '--text', '--bg'].filter((token) => style.getPropertyValue(token).trim() !== root.getPropertyValue(token).trim());
          });
        });
        expect(mismatches, `${route} must not replace the selected theme with a private palette`).toEqual([]);
      }
      await page.goto('/more', { waitUntil: 'domcontentloaded' });
    }
    assertNoBackendRequests(requests);
  });

  test('desktop Trade composes a chart beside the ticket, mobile keeps the chart optional', async ({ page, requests }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    const chart = page.locator('.market-chart-panel');
    const ticket = page.locator('.trade-ticket');
    await expect(chart).toBeVisible();
    await expect(ticket).toBeVisible();
    await expect(chart.getByText('f(x) market · Ethereum', { exact: true })).toHaveCount(0);
    await expect(chart.getByText('CoinGecko history · display only', { exact: true })).toHaveCount(0);
    await expect(chart.getByRole('link', { name: 'CoinGecko', exact: true })).toBeVisible();
    const chartBox = await chart.boundingBox();
    const ticketBox = await ticket.boundingBox();
    expect(chartBox).not.toBeNull();
    expect(ticketBox).not.toBeNull();
    expect(chartBox!.x + chartBox!.width).toBeLessThan(ticketBox!.x);
    expect(Math.abs(chartBox!.y - ticketBox!.y)).toBeLessThan(5);
    await expect(page.getByRole('navigation', { name: 'Primary navigation' }).filter({ visible: true })).toHaveCount(1);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Show chart' })).toBeVisible();
    await expect(page.locator('.market-chart-content')).toBeHidden();
    await expect(page.getByLabel('Input asset')).toBeVisible();
    await expect(page.getByLabel('Amount in ETH', { exact: true })).toBeVisible();
    const combined = await page.getByLabel('Input asset').evaluate((element) => Boolean(element.closest('.amount-control')));
    expect(combined, 'asset selection belongs to the amount control rather than a duplicate field').toBe(true);
    assertNoBackendRequests(requests);
  });

  test('the guide is discoverable, searchable, and supports mobile section deep links', async ({ page, requests }) => {
    await page.goto('/more', { waitUntil: 'domcontentloaded' });
    await page.locator('main').getByRole('link', { name: /FxAeon docs/i }).click();
    await expect(page).toHaveURL(/\/docs\/?$/);
    const nav = page.getByRole('navigation', { name: 'Documentation sections' });
    const search = nav.getByRole('searchbox', { name: 'Search docs' });
    await expect(nav.getByRole('link')).toHaveCount(13);
    await search.fill('slippage');
    await expect(nav.getByRole('link')).toHaveCount(1);
    await expect(nav.getByText('1 section', { exact: true })).toBeVisible();
    // Search filters the index, never the underlying article or anchors.
    await expect(page.getByRole('heading', { name: 'Getting started', exact: true })).toBeAttached();
    await search.press('Tab');
    await expect(nav.getByRole('button', { name: 'Clear', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(nav.getByRole('link', { name: 'Fees & slippage', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#fees$/);
    const articleHeading = page.getByRole('heading', { name: 'Fees & slippage', exact: true });
    await expect(articleHeading).toBeInViewport();
    await expect.poll(async () => {
      const heading = await articleHeading.boundingBox();
      const rail = await nav.boundingBox();
      return heading!.y >= rail!.y + rail!.height;
    }).toBe(true);
    await search.fill('no-matching-section');
    await expect(nav.getByRole('link')).toHaveCount(0);
    await expect(nav.getByText('No sections found', { exact: true })).toBeVisible();
    await nav.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(nav.getByRole('link')).toHaveCount(13);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(articleHeading).toBeInViewport();
    assertNoBackendRequests(requests);
  });

  test('leverage keeps a full touch target and keyboard control at mobile and desktop widths', async ({ page, requests }) => {
    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    const slider = page.getByRole('slider', { name: 'Target leverage slider', exact: true });
    const amount = page.getByRole('spinbutton', { name: 'Target leverage', exact: true });
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(slider).toBeVisible();
      expect((await slider.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await amount.fill('2');
      await slider.focus();
      await slider.press('ArrowRight');
      await expect(slider).toHaveValue('2.1');
      await expect(amount).toHaveValue('2.1');
    }
    assertNoBackendRequests(requests);
  });
});

test.describe('light theme overlays', () => {
  test.use({ telegram: false, browserWallet: { address: '0x930f0000000000000000000000000000000098b9', initiallyConnected: true } });

  test('wallet and token portals use the light palette and restore focus', async ({ page, requests }) => {
    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Open wallet profile' })).toBeVisible();
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await page.getByRole('button', { name: 'Open wallet profile' }).click();
    const wallet = page.getByRole('dialog', { name: 'Wallet profile' });
    await expect(wallet).toBeVisible();
    expect(await wallet.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 255, 255)');
    await page.keyboard.press('Escape');
    await expect(wallet).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open wallet profile' })).toBeFocused();
    await page.getByLabel('Input asset').click();
    const picker = page.getByRole('dialog', { name: 'Input asset' });
    await expect(picker).toBeVisible();
    // A browser extension, assistive technology, or application code can move
    // focus without pressing Tab. The modal must recover containment too.
    await page.getByRole('button', { name: 'Open wallet profile' }).evaluate((button) => (button as HTMLButtonElement).focus());
    await expect.poll(() => picker.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    const palette = await picker.evaluate((element) => {
      const style = getComputedStyle(element);
      const root = getComputedStyle(document.documentElement);
      return { accent: style.getPropertyValue('--mint').trim(), expected: root.getPropertyValue('--mint').trim() };
    });
    expect(palette.accent).toBe(palette.expected);
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await expect(page.getByLabel('Input asset')).toBeFocused();
    assertNoBackendRequests(requests);
  });
});
