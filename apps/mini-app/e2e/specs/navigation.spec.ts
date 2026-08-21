import { test, expect } from '../fixtures/test';

/** The five primary tabs are the gateway's stable mobile information architecture. */
test.describe('Gateway navigation', () => {
  test('moves through Home, Trade, Earn, Move, and More', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText('$5,240.75')).toBeVisible();

    const tabs = page.getByRole('navigation', { name: 'Primary navigation' });
    await expect(tabs.getByRole('link')).toHaveCount(5);

    for (const [name, path, heading] of [
      ['Trade', '/trade', 'Trade'],
      ['Earn', '/earn', 'Earn'],
      ['Move', '/move', 'Move'],
      ['More', '/more', 'More'],
      ['Home', '/portfolio', null],
    ] as const) {
      await tabs.getByRole('link', { name }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      if (heading) await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await expect(tabs.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
    }
  });

  test('More exposes every secondary protocol, wallet, and safety surface', async ({ page }) => {
    await page.goto('/more');
    await expect(page.getByText('Signer on')).toBeVisible();

    const routes = [
      ['Positions', '/positions', 'Positions'],
      ['Borrow fxUSD', '/borrow', 'Borrow'],
      ['Activity', '/activity', 'Activity'],
      ['Receive assets', '/qr', null],
      ['Settings', '/settings', 'Settings'],
      ['Execution policy', '/policy', null],
    ] as const;

    for (const [name, path, heading] of routes) {
      await page.goto('/more');
      await page.getByRole('link', { name: new RegExp(`^${name}`) }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      if (heading) await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    }

    await page.goto('/more');
    await expect(page.getByRole('link', { name: /^Open chat bot/ })).toHaveAttribute('href', 'https://t.me/FxAeonBot');
    await expect(page.getByRole('link', { name: /^f\(x\) Protocol/ })).toHaveAttribute('target', '_blank');
    await expect(page.getByRole('link', { name: /^Protocol docs/ })).toHaveAttribute('rel', /noopener/);
  });
});
