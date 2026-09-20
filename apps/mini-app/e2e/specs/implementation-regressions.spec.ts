import { expect, test, assertNoBackendRequests } from '../fixtures/test';

const WALLET = '0x930f0000000000000000000000000000000098b9';

test.describe('implementation regressions', () => {
  test.use({ telegram: false });

  test.describe('connected desktop Portfolio', () => {
    test.use({ browserWallet: { address: WALLET, initiallyConnected: true } });

    test('keeps every internal action visible and clickable', async ({ page, requests }) => {
    for (const viewport of [{ width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
      const actions = page.locator('section[aria-labelledby="portfolio-actions-title"] a');
      await expect(actions).toHaveCount(4);
      for (let index = 0; index < await actions.count(); index += 1) {
        const action = actions.nth(index);
        await expect(action).toBeVisible();
        const geometry = await action.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const clippingAncestors: Array<{ left: number; right: number; top: number; bottom: number }> = [];
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (/(auto|scroll|hidden|clip)/.test(`${style.overflow}${style.overflowX}${style.overflowY}`)) {
              const bounds = parent.getBoundingClientRect();
              clippingAncestors.push({ left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom });
            }
          }
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const hit = document.elementFromPoint(x, y);
          return {
            left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
            clippingAncestors,
            viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
            hitIsAction: hit === element || Boolean(hit && element.contains(hit)),
          };
        });
        expect(geometry.right, `Portfolio action ${index + 1} must fit at ${viewport.width}px`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
        expect(geometry.left, `Portfolio action ${index + 1} must fit at ${viewport.width}px`).toBeGreaterThanOrEqual(-1);
        expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
        expect(geometry.top).toBeGreaterThanOrEqual(-1);
        for (const ancestor of geometry.clippingAncestors) {
          expect(geometry.left).toBeGreaterThanOrEqual(ancestor.left - 1);
          expect(geometry.right).toBeLessThanOrEqual(ancestor.right + 1);
          expect(geometry.top).toBeGreaterThanOrEqual(ancestor.top - 1);
          expect(geometry.bottom).toBeLessThanOrEqual(ancestor.bottom + 1);
        }
        expect(geometry.right - geometry.left).toBeGreaterThanOrEqual(44);
        expect(geometry.bottom - geometry.top).toBeGreaterThanOrEqual(44);
        expect(geometry.hitIsAction, `Portfolio action ${index + 1} must receive pointer input`).toBe(true);

        const href = await action.getAttribute('href');
        expect(href).toMatch(/^\/(?:qr|trade|move|earn)$/);
        await action.click();
        await expect(page).toHaveURL(new RegExp(`${href!.replace('/', '\\/')}(?:\\/)?$`));
        await page.goBack({ waitUntil: 'domcontentloaded' });
      }
    }
    assertNoBackendRequests(requests);
    });
  });

  test.describe('connected Portfolio history', () => {
    test.use({ browserWallet: { address: WALLET, initiallyConnected: true } });

    test('keeps recent history last and removes the empty placeholder card', async ({ page, requests }) => {
      for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(viewport);
        await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
        const recent = page.locator('section[aria-labelledby="recent-activity-title"]');
        await expect(recent).toHaveCount(1);
        await expect(recent).toBeVisible();
        await expect(recent.getByText('No recent FxAeon history', { exact: true })).toHaveCount(0);
        const recentTop = await recent.evaluate((element) => element.getBoundingClientRect().top);
        const siblingTops = await recent.evaluate((element) => Array.from(element.parentElement?.querySelectorAll(':scope > section') ?? [], (sibling) => sibling.getBoundingClientRect().top));
        expect(recentTop, `Recent history must be the last visible Portfolio section at ${viewport.width}px`).toBeGreaterThanOrEqual(Math.max(...siblingTops));
      }
      assertNoBackendRequests(requests);
    });
  });

  test.describe('connected Borrow', () => {
    test.use({
      browserWallet: { address: WALLET, initiallyConnected: true },
    });

    test('never presents a duplicate read skeleton and form', async ({ page, requests }) => {
      await page.goto('/borrow', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main:visible')).toBeVisible();

      await expect.poll(async () => {
        const loading = await page.locator('[aria-label="Reading borrowing positions"]:visible').count();
        const forms = await page.locator('input[aria-label^="Starting collateral in "]:visible, input[aria-label^="Collateral to add in "]:visible').count();
        return loading <= 1 && forms <= 1 && (loading === 0 || forms === 0);
      }, { timeout: 10_000 }).toBe(true);
      const loading = await page.locator('[aria-label="Reading borrowing positions"]:visible').count();
      const forms = await page.locator('input[aria-label^="Starting collateral in "]:visible, input[aria-label^="Collateral to add in "]:visible').count();
      expect(loading * forms, 'a connected Borrow read must not duplicate its skeleton and editor').toBe(0);
      assertNoBackendRequests(requests);
    });
  });

  test.describe('connected More wallet controls', () => {
    test.use({ browserWallet: { address: WALLET, initiallyConnected: true } });

    test('exposes protocol resources and disconnects in place', async ({ page, requests }) => {
      await page.goto('/more', { waitUntil: 'domcontentloaded' });
      const resource = page.getByRole('link', { name: 'f(x) protocol docs (opens in a new tab)', exact: true });
      await expect(resource).toBeVisible();
      await expect(resource).toHaveAttribute('href', 'https://fxprotocol.gitbook.io/fx-docs');
      await expect(resource).toHaveAttribute('target', '_blank');

      await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
      await expect(page.getByText('Connect a wallet', { exact: true })).toBeVisible();
      await expect(page.getByRole('main').getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
      await expect(page).toHaveURL(/\/more\/?$/);
      assertNoBackendRequests(requests);
    });
  });

  test('Docs collapses contents into a compact reading region on short phones', async ({ page, requests }) => {
    const viewport = { width: 390, height: 500 } as const;
    await page.setViewportSize(viewport);
    await page.goto('/docs', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main:visible')).toBeVisible();

    const mainGeometry = await page.locator('main').evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(mainGeometry.scrollWidth).toBeLessThanOrEqual(mainGeometry.clientWidth + 1);
    expect(mainGeometry.width).toBeLessThanOrEqual(390 + 1);
    const docsNav = page.locator('nav[aria-label="Documentation sections"]');
    await expect(docsNav).toHaveAttribute('aria-busy', 'false');
    const navGeometry = await docsNav.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    });
    // The compact disclosure should leave the start of the actual guide in
    // the first short viewport; a tall search/contents rail makes the docs
    // technically present but unusable on Telegram's smallest window.
    expect(navGeometry.height, 'compact Docs search/contents must stay short').toBeLessThanOrEqual(100);
    const article = page.locator('[class*="docsContent"]').first();
    await expect(article).toBeVisible();
    await expect(article.locator('header').first()).toBeVisible();
    await expect(article.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    await expect(article.getByText('Understand every route.', { exact: true })).toHaveCount(0);
    const helpGeometry = await article.locator('section#overview').evaluate((element) => {
      const heading = element.querySelector('h2')?.getBoundingClientRect();
      const paragraph = element.querySelector('p')?.getBoundingClientRect();
      return {
        headingTop: heading?.top ?? Number.POSITIVE_INFINITY,
        paragraphTop: paragraph?.top ?? Number.POSITIVE_INFINITY,
        paragraphBottom: paragraph ? paragraph.bottom : Number.POSITIVE_INFINITY,
      };
    });
    expect(helpGeometry.headingTop, 'Docs heading must enter the short viewport').toBeLessThan(viewport.height);
    expect(helpGeometry.paragraphTop, 'Docs help text must enter the short viewport').toBeLessThan(viewport.height);
    expect(helpGeometry.paragraphBottom, 'Docs help text must stay inside the short viewport').toBeLessThanOrEqual(viewport.height + 1);

    const contents = page.locator('details').filter({ has: page.getByText('Contents', { exact: true }) });
    await expect(contents).toHaveCount(1);
    await expect(contents).toHaveJSProperty('open', false);
    await contents.locator('summary').click();
    await expect(contents).toHaveJSProperty('open', true);
    await expect(contents.getByRole('link')).toHaveCount(13);
    await expect(contents.getByRole('link', { name: 'Overview', exact: true })).toBeVisible();

    await page.setViewportSize({ width: 1024, height: 500 });
    await page.goto('/docs', { waitUntil: 'domcontentloaded' });
    const docsRail = page.locator('nav[aria-label="Documentation sections"]');
    await expect(docsRail).toHaveAttribute('aria-busy', 'false');
    const lastLink = docsRail.getByRole('link', { name: 'Troubleshooting', exact: true });
    await expect(lastLink).toBeVisible();
    await lastLink.scrollIntoViewIfNeeded();
    const railGeometry = await docsRail.evaluate((element) => {
      const rail = element.getBoundingClientRect();
      const link = element.querySelector('a[href="#troubleshooting"]')!.getBoundingClientRect();
      return { railTop: rail.top, railBottom: rail.bottom, linkTop: link.top, linkBottom: link.bottom };
    });
    expect(railGeometry.linkTop).toBeGreaterThanOrEqual(railGeometry.railTop - 1);
    expect(railGeometry.linkBottom).toBeLessThanOrEqual(railGeometry.railBottom + 1);
    assertNoBackendRequests(requests);
  });

  test('settings preserves reachable browser wallet controls', async ({ page, requests }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();
    const main = page.getByRole('main');
    const connect = main.getByRole('button', { name: 'Connect wallet', exact: true });
    await expect(connect).toBeVisible();
    await expect(connect).toBeEnabled();
    await connect.click();
    await expect(page).toHaveURL(/\/settings\/?$/);
    await expect(connect).toBeVisible();
    assertNoBackendRequests(requests);
  });

  test.describe('connected settings', () => {
    test.use({ browserWallet: { address: WALLET, initiallyConnected: true } });

    test('keeps wallet session controls reachable at desktop and short-phone widths', async ({ page, requests }) => {
      for (const viewport of [{ width: 390, height: 500 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(viewport);
        await page.goto('/settings', { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Reconnect wallet', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
        for (const button of [
          page.getByRole('button', { name: 'Save changes', exact: true }),
          page.getByRole('button', { name: 'Sign out', exact: true }),
        ]) {
          await button.scrollIntoViewIfNeeded();
          const box = await button.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.width).toBeGreaterThanOrEqual(44);
          expect(box!.height).toBeGreaterThanOrEqual(44);
          expect(box!.y).toBeGreaterThanOrEqual(-1);
          expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
          const hit = await button.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return target === element || Boolean(target && element.contains(target));
          });
          expect(hit, `Settings ${await button.innerText()} must receive pointer input`).toBe(true);
        }
      }
      assertNoBackendRequests(requests);
    });
  });
});
