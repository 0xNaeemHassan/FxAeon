import { expect, test, assertNoBackendRequests } from '../fixtures/test';

test.describe('Portfolio mobile hierarchy', () => {
  test.use({ telegram: false, browserWallet: { initiallyConnected: true } });

  test('keeps network filters within Assets and uses the page scroller', async ({ page, requests }) => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
      const assets = page.getByRole('region', { name: 'Assets', exact: true });
      const filters = page.getByRole('group', { name: 'Portfolio network', exact: true });
      await expect(assets).toBeVisible();
      await expect(filters).toBeVisible();
      expect(await filters.evaluate((element) => element.closest('section[aria-labelledby="portfolio-assets-heading"]') !== null)).toBe(true);
      await filters.getByRole('button', { name: 'Base', exact: true }).click();
      await expect(filters.getByRole('button', { name: 'Base', exact: true })).toHaveAttribute('aria-pressed', 'true');
      const overflow = await assets.evaluate((element) => getComputedStyle(element).overflowY);
      expect(overflow).not.toMatch(/auto|scroll/);
      await expect(page.locator('section[aria-labelledby="portfolio-actions-title"] a')).toHaveCount(4);
    }
    assertNoBackendRequests(requests);
  });
});
