import { test, expect, assertNoBackendRequests } from '../fixtures/test';

test.describe('transaction review wallet entry', () => {
  test.use({
    telegram: false,
    browserWallet: {
      address: '0x930f0000000000000000000000000000000098b9',
      initiallyConnected: false,
    },
  });

  for (const route of ['/trade', '/move']) {
    test(`${route} keeps the review rail as the wallet entry`, async ({ page, requests }) => {
      await page.goto(route, { waitUntil: 'domcontentloaded' });

      const main = page.getByRole('main');
      // The top bar owns the first matching button; the embedded review CTA
      // is the last and remains inside the route's action card.
      const walletEntries = page.getByRole('button', { name: 'Connect wallet', exact: true });
      await expect(walletEntries).toHaveCount(2);
      const reviewEntry = walletEntries.last();
      await expect(reviewEntry).toBeVisible();
      // The review rail owns this transition; no separate wallet card should
      // compete with it on a screen that already has an actionable review.
      await expect(main.locator('.wallet-connect-cta')).toHaveCount(0);

      await reviewEntry.click();
      await expect(page).toHaveURL(new RegExp(`${route}/?$`));
      await expect(page.getByRole('button', { name: 'Open wallet profile', exact: true })).toBeVisible();
      assertNoBackendRequests(requests);
    });
  }

  test.describe('browser discovery queue', () => {
    test.use({
      browserWallet: {
        address: '0x930f0000000000000000000000000000000098b9',
        initiallyConnected: false,
      },
    });

    test('queues a review-rail connection while browser discovery is still settling', async ({ page, requests }) => {
    // Hold the injected provider until after the app has rendered its initial
    // disconnected action rail. The click must queue rather than be disabled.
    await page.addInitScript(() => {
      const target = window as unknown as { ethereum?: unknown; __wallet?: { provider?: unknown } };
      let injected = target.ethereum;
      Object.defineProperty(target, 'ethereum', {
        configurable: true,
        get: () => undefined,
        set: (value: unknown) => { injected = value; },
      });
      window.setTimeout(() => {
        injected ??= target.__wallet?.provider;
        delete target.ethereum;
        (window as unknown as { ethereum?: unknown }).ethereum = injected;
        window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
          detail: { provider: injected, info: { name: 'Test wallet', rdns: 'com.fxaeon.test' } },
        }));
      }, 600);
    });
    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    const reviewEntry = page.locator('.reviewTrigger').getByRole('button', { name: 'Connect wallet', exact: true });
    await expect(reviewEntry).toBeVisible();
    await reviewEntry.click();
    await expect(page.getByRole('button', { name: 'Opening wallet…', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open wallet profile', exact: true })).toBeVisible({ timeout: 10_000 });
      assertNoBackendRequests(requests);
    });
  });
});
