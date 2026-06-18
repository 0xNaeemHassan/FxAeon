import { test, expect } from '../fixtures/test';
import { executeDeduped } from '../fixtures/data';

/**
 * In-app trade execution — the Mini App side of the money path (mockup screens
 * 2/3/5). The app never builds calldata or signs; Confirm calls the bot's
 * server-side, simulate-gated, session-signer engine via /trade/quote and
 * /trade/execute. This drives the whole build → review → gas → confirm → result
 * flow against fixtures.
 */
test.describe('Trade flow', () => {
  test('build → review quote → pick Fast gas → confirm → success receipt', async ({ page }) => {
    await page.goto('/trade?market=wstETH&side=long&lev=3');

    // Builder: enter collateral, exposure preview appears.
    await page.locator('#amt').fill('1');
    await expect(page.getByText(/Total exposure/)).toBeVisible();
    await expect(page.getByText('3 wstETH')).toBeVisible();

    // Review quote (server-derived).
    await page.getByRole('button', { name: /Review & confirm in chat/ }).click();
    await expect(page.getByText(/Open long.*wstETH 3x/)).toBeVisible();
    await expect(page.getByText('You pay')).toBeVisible();
    await expect(page.getByText('Position size').first()).toBeVisible();
    await expect(page.getByText('Entry price')).toBeVisible();
    await expect(page.getByText('$3,500.42')).toBeVisible();

    // Expand the real Slow/Market/Fast gas picker (screen 3) and pick Fast.
    await page.getByRole('button', { name: /Network fee/ }).click();
    await expect(page.getByText('Transaction speed')).toBeVisible();
    await page.getByText('Fast', { exact: true }).click();
    await expect(page.getByText('Priority fee')).toBeVisible();

    // Confirm & sign → executing → done (screen 5).
    await page.getByRole('button', { name: /Confirm & Sign/ }).click();
    await expect(page.getByText('Position opened')).toBeVisible({ timeout: 15_000 });

    // Real on-chain receipt detail.
    await expect(page.getByText('Confirmed').first()).toBeVisible();
    await expect(page.getByText('#19,000,000')).toBeVisible();
    await expect(page.getByRole('link', { name: /View on Etherscan/ })).toHaveAttribute(
      'href',
      /etherscan\.io\/tx\/0x/
    );
  });

  test('idempotent retry: a deduped execute is surfaced honestly', async ({ page, api }) => {
    api.setExecute(executeDeduped);
    await page.goto('/trade?market=wstETH&side=long&lev=3');
    await page.locator('#amt').fill('1');
    await page.getByRole('button', { name: /Review & confirm in chat/ }).click();
    await page.getByRole('button', { name: /Confirm & Sign/ }).click();

    await expect(page.getByText('Position opened')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Already submitted (no duplicate sent)')).toBeVisible();
  });

  test('bot trading off → failure screen routes to enable trading', async ({ page, api }) => {
    api.fail('POST', '/trade/execute', 403, 'BOT_TRADING_OFF', 'Bot trading is not enabled for this wallet.');
    await page.goto('/trade?market=wstETH&side=long&lev=3');
    await page.locator('#amt').fill('1');
    await page.getByRole('button', { name: /Review & confirm in chat/ }).click();
    await page.getByRole('button', { name: /Confirm & Sign/ }).click();

    await expect(page.getByText('Could not open')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Enable bot trading' })).toBeVisible();
  });

  test('quote failure shows a retryable warning, not a fake quote', async ({ page, api }) => {
    api.fail('POST', '/trade/quote', 502, 'QUOTE_FAILED', 'Upstream route builder is unavailable.');
    await page.goto('/trade?market=wstETH&side=long&lev=3');
    await page.locator('#amt').fill('1');
    await page.getByRole('button', { name: /Review & confirm in chat/ }).click();

    await expect(page.getByText('Upstream route builder is unavailable.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh quote' }).first()).toBeVisible();
  });
});
