import { test, expect } from '../fixtures/test';
import { emptyMe } from '../fixtures/data';

/**
 * Portfolio — the authenticated home screen. Every value is API-driven; this
 * verifies the loaded state, the Positions/fxUSD tabs, the honest empty and
 * degraded states, and the "incomplete read" banners.
 */
test.describe('Portfolio', () => {
  test('renders the loaded account: total value, positions, markets, wallet', async ({ page }) => {
    await page.goto('/portfolio');

    // Total Value hero + unrealized PnL badge.
    await expect(page.getByText('Total Value')).toBeVisible();
    await expect(page.getByText('$5,240.75')).toBeVisible();
    await expect(page.getByText(/\+\$92\.40/)).toBeVisible();
    await expect(page.getByText(/\+1\.79%/)).toBeVisible();

    // Position cards (Positions tab is default).
    await expect(page.getByText('wstETH', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('+$124.50')).toBeVisible();
    await expect(page.getByText('-$32.10')).toBeVisible();

    // Wallet chip (shortened) + self-custody badge + balances.
    await expect(page.getByText('0x742d…f44e')).toBeVisible();
    await expect(page.getByText('self-custody', { exact: true })).toBeVisible();
    await expect(page.getByText('1.25', { exact: false }).first()).toBeVisible();

    // Live markets table.
    await expect(page.getByText('Markets')).toBeVisible();
    await expect(page.getByText('$3,500').first()).toBeVisible();
  });

  test('fxUSD tab shows the real fxSAVE stability-pool position', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText('$5,240.75')).toBeVisible();

    await page.getByRole('button', { name: 'fxUSD' }).click();
    await expect(page.getByText('fxUSD Stability Pool')).toBeVisible();
    await expect(page.getByText('$1,215.50')).toBeVisible();
  });

  test('empty account shows honest "no positions" + fund prompt', async ({ page, api }) => {
    api.setMe(emptyMe);
    await page.goto('/portfolio');

    await expect(page.getByText('No open positions')).toBeVisible();
    // Unfunded → fund-your-wallet nudge with a deposit action.
    await expect(page.getByText('Fund your wallet to start trading.')).toBeVisible();
    await expect(page.getByText('Show deposit address')).toBeVisible();
  });

  test('API auth failure surfaces an honest load-failed state with retry', async ({ page, api }) => {
    api.fail('GET', '/me', 401, 'AUTH_REQUIRED', 'Telegram authentication failed');
    await page.goto('/portfolio');

    await expect(page.getByText('Couldn’t load your account')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });
});
