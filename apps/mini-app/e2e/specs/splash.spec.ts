import { test, expect } from '../fixtures/test';

/**
 * Plain-browser launch (no Telegram). The app is a Telegram product, so outside
 * Telegram it must show an honest "Open in Telegram" splash rather than a dead
 * screen — and protected screens must not fabricate data.
 */
test.use({ telegram: false });

test.describe('Browser splash (no Telegram)', () => {
  test('home shows the "Open in Telegram" splash', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /FxAeon/ })).toBeVisible();
    await expect(
      page.getByText(/Non-custodial leveraged trading on f\(x\) Protocol/)
    ).toBeVisible();
    const cta = page.getByRole('link', { name: /Open in Telegram/ });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', /t\.me\/FxAeonBot/);
  });

  test('portfolio degrades to an "open in Telegram" empty state', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByText('Open FxAeon in Telegram')).toBeVisible();
    await expect(page.getByRole('link', { name: /Open @FxAeonBot/ })).toBeVisible();
  });
});
