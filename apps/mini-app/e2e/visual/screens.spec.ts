import { test, expect } from '../fixtures/test';
import { settle } from '../fixtures/visual';
import { emptyMe } from '../fixtures/data';

/**
 * Visual-regression baselines for the product's key surfaces. Animations are
 * frozen (playwright config) and fonts are awaited (settle) so the snapshots are
 * pixel-stable. Full-page captures cover the scrollable screens.
 *
 * Regenerate baselines intentionally with:
 *   pnpm --filter @fxaeon/mini-app test:e2e:update
 */
test.describe('Visual regression', () => {
  test.describe('browser (no Telegram)', () => {
    test.use({ telegram: false });
    test('splash', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByText(/Non-custodial leveraged trading/)).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot('splash.png', { fullPage: true });
    });
  });

  test('login — operator not-configured gate', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Wallet service not configured' })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('login-not-configured.png', { fullPage: true });
  });

  test('portfolio — loaded account', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText('$5,240.75')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('portfolio-loaded.png', { fullPage: true });
  });

  test('portfolio — fxUSD savings tab', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText('$5,240.75')).toBeVisible();
    await page.getByRole('button', { name: 'fxUSD' }).click();
    await expect(page.getByText('fxUSD Stability Pool')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('portfolio-fxusd.png', { fullPage: true });
  });

  test('portfolio — empty / unfunded', async ({ page, api }) => {
    api.setMe(emptyMe);
    await page.goto('/portfolio');
    await expect(page.getByText('No open positions')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('portfolio-empty.png', { fullPage: true });
  });

  test('trade — builder', async ({ page }) => {
    await page.goto('/trade?market=wstETH&side=long&lev=3');
    await page.locator('#amt').fill('1');
    await expect(page.getByText(/Total exposure/)).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('trade-builder.png', { fullPage: true });
  });

  test('trade — review quote (gas expanded)', async ({ page }) => {
    await page.goto('/trade?market=wstETH&side=long&lev=3');
    await page.locator('#amt').fill('1');
    await page.getByRole('button', { name: /Review & confirm in chat/ }).click();
    await expect(page.getByText('You pay')).toBeVisible();
    await page.getByRole('button', { name: /Network fee/ }).click();
    await expect(page.getByText('Transaction speed')).toBeVisible();
    await settle(page);
    // The live quote TTL counts down ("15s" → …) — mask it so it never flaps.
    await expect(page).toHaveScreenshot('trade-review.png', {
      fullPage: true,
      mask: [page.getByRole('button', { name: 'Refresh quote' })],
    });
  });

  test('trade — success result', async ({ page }) => {
    await page.goto('/trade?market=wstETH&side=long&lev=3');
    await page.locator('#amt').fill('1');
    await page.getByRole('button', { name: /Review & confirm in chat/ }).click();
    await page.getByRole('button', { name: /Confirm & Sign/ }).click();
    await expect(page.getByText('Position opened')).toBeVisible({ timeout: 15_000 });
    await settle(page);
    await expect(page).toHaveScreenshot('trade-success.png', { fullPage: true });
  });

  test('settings', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('settings.png', { fullPage: true });
  });

  test('deposit (qr)', async ({ page }) => {
    await page.goto('/qr');
    await settle(page);
    await expect(page).toHaveScreenshot('deposit-qr.png', { fullPage: true });
  });
});
