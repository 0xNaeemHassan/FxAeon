import { test, expect } from '../fixtures/test';

/**
 * Login gates. The test build ships no NEXT_PUBLIC_PRIVY_APP_ID, so inside
 * Telegram the login surface must render the honest "wallet service not
 * configured" operator message instead of crashing or loading the heavy Privy
 * SDK. Outside Telegram it points the user back to the bot.
 */
test.describe('Login gate (inside Telegram, Privy unconfigured)', () => {
  test('shows the operator "not configured" message', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Wallet service not configured' })).toBeVisible();
    await expect(page.getByText(/NEXT_PUBLIC_PRIVY_APP_ID/)).toBeVisible();
  });
});

test.describe('Login gate (browser)', () => {
  test.use({ telegram: false });
  test('shows the open-in-Telegram gate', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'FxAeon runs inside Telegram' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Open @FxAeonBot/ })).toBeVisible();
  });
});
