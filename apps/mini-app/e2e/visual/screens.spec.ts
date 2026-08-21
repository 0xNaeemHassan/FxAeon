import { test, expect } from '../fixtures/test';
import { settle } from '../fixtures/visual';
import { emptyMe } from '../fixtures/data';

/** Pixel-level contracts for the gateway's primary mobile surfaces. */
test.describe('Visual regression', () => {
  test.describe('browser (no Telegram)', () => {
    test.use({ telegram: false });
    test('splash', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByText(/Trade, borrow, save, bridge/)).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot('splash.png', { fullPage: true });
    });
  });

  test('login - operator not-configured gate', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Wallet service not configured' })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('login-not-configured.png', { fullPage: true });
  });

  test('portfolio - loaded account', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText('$5,240.75')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('portfolio-loaded.png', { fullPage: true });
  });

  test('portfolio - fxUSD savings tab', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText('$5,240.75')).toBeVisible();
    await page.getByRole('tab', { name: 'fxUSD' }).click();
    await expect(page.getByText('fxUSD Stability Pool')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('portfolio-fxusd.png', { fullPage: true });
  });

  test('portfolio - empty / unfunded', async ({ page, api }) => {
    api.setMe(emptyMe);
    await page.goto('/portfolio');
    await expect(page.getByText('No open positions')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('portfolio-empty.png', { fullPage: true });
  });

  test('trade - builder', async ({ page }) => {
    await page.goto('/trade');
    await page.getByLabel('Input amount in ETH').fill('1');
    await expect(page.getByText('1 ETH', { exact: true })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('trade-builder.png', { fullPage: true });
  });

  test('trade - action review', async ({ page }) => {
    await page.goto('/trade');
    await page.getByLabel('Input amount in ETH').fill('1');
    await page.getByRole('button', { name: 'Review wstETH long' }).click();
    await expect(page.getByText('Open wstETH long', { exact: true })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('trade-review.png', { fullPage: true });
  });

  test('trade - success result', async ({ page }) => {
    await page.goto('/trade');
    await page.getByLabel('Input amount in ETH').fill('1');
    await page.getByRole('button', { name: 'Review wstETH long' }).click();
    await page.getByRole('button', { name: /Confirm and execute/ }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed on-chain' })).toBeVisible({ timeout: 15_000 });
    await settle(page);
    await expect(page).toHaveScreenshot('trade-success.png', { fullPage: true });
  });

  test('earn - live fxSAVE deposit', async ({ page }) => {
    await page.goto('/earn');
    await expect(page.getByText('1.025 fxUSD', { exact: true })).toBeVisible();
    await page.getByLabel('Amount in fxUSD').fill('250');
    await settle(page);
    await expect(page).toHaveScreenshot('earn-deposit.png', { fullPage: true });
  });

  test('move - Base to Ethereum', async ({ page }) => {
    await page.goto('/move');
    await page.getByRole('radio', { name: /To Ethereum/ }).click();
    await page.getByLabel('Amount on Base in fxUSD').fill('25');
    await settle(page);
    await expect(page).toHaveScreenshot('move-base-to-ethereum.png', { fullPage: true });
  });

  test('more - complete toolkit', async ({ page }) => {
    await page.goto('/more');
    await expect(page.getByText('Signer on')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('more.png', { fullPage: true });
  });

  test('settings', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot('settings.png', { fullPage: true });
  });

  test('receive (qr)', async ({ page }) => {
    await page.goto('/qr');
    await settle(page);
    await expect(page).toHaveScreenshot('deposit-qr.png', { fullPage: true });
  });
});
