import { test, expect } from '../fixtures/test';

/**
 * Bottom tab-bar navigation between the app's root surfaces. Uses Next.js
 * client-side routing (no full reload), exactly as in Telegram.
 */
test.describe('Tab navigation', () => {
  test('navigates Portfolio → Trade → Deposit → Settings', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText('$5,240.75')).toBeVisible();

    // Scope to the bottom tab bar (other surfaces also link to these routes).
    const tabs = page.getByRole('navigation');

    await tabs.getByRole('link', { name: 'Trade' }).click();
    await expect(page).toHaveURL(/\/trade$/);
    await expect(page.getByRole('heading', { name: 'Trade' })).toBeVisible();

    await tabs.getByRole('link', { name: 'Deposit' }).click();
    await expect(page).toHaveURL(/\/qr$/);

    await tabs.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    await tabs.getByRole('link', { name: 'Home' }).click();
    await expect(page).toHaveURL(/\/portfolio$/);
  });
});
