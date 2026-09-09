import { expect, test, assertNoBackendRequests } from '../fixtures/test';

test.describe('shared shell spacing', () => {
  test.use({ telegram: false });

  test('keeps product headers close to the top bar without overlap', async ({ page, requests }) => {
    test.setTimeout(120_000);
    const routes = ['/portfolio', '/trade', '/earn', '/borrow', '/move', '/settings'];
    const viewports = [
      { width: 320, height: 568, maxGap: 9 },
      { width: 390, height: 844, maxGap: 15 },
      { width: 1280, height: 900, maxGap: 21 },
    ];

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const route of routes) {
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        const topbar = page.locator('.app-topbar');
        const header = page.locator('.page-header:visible, .trade-page-heading:visible, .portfolio-page-heading:visible').first();
        await expect(topbar).toBeVisible();
        if (await header.count() === 0) continue;

        const geometry = await header.evaluate((element) => {
          const topbar = document.querySelector<HTMLElement>('.app-topbar');
          if (!topbar) throw new Error('top bar is missing');
          const topbarRect = topbar.getBoundingClientRect();
          const headerRect = element.getBoundingClientRect();
          const hidden = headerRect.width <= 1 && headerRect.height <= 1;
          return {
            gap: headerRect.top - topbarRect.bottom,
            topbarBottom: topbarRect.bottom,
            headerTop: headerRect.top,
            hidden,
          };
        });

        // Product route headings are intentionally visually hidden on phones;
        // keep their accessible text without reserving layout space.
        if (geometry.hidden) continue;

        expect(geometry.gap, `${route} must not overlap the top bar`).toBeGreaterThanOrEqual(0);
        expect(geometry.gap, `${route} has excessive shell/header spacing at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(viewport.maxGap);
        expect(geometry.headerTop, `${route} header must follow the top bar`).toBeGreaterThanOrEqual(geometry.topbarBottom);
      }
    }

    assertNoBackendRequests(requests);
  });
});
