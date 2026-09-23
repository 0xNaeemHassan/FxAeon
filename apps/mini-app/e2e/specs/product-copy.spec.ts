import { expect, test, assertNoBackendRequests } from '../fixtures/test';

test.describe('product copy and session visibility', () => {
  test.use({ telegram: false });

  test('root identifies the Portfolio app and its canonical domain', async ({ page, requests }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/$/);
    await expect(page).toHaveTitle('Portfolio · FxAeon');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /^https:\/\/fxaeon\.com\/?$/);
    await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();
    assertNoBackendRequests(requests);
  });

  test('portfolio omits the redundant protocol-state subtitle', async ({ page, requests }) => {
    await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();
    await expect(page.getByText('Wallet assets and verified f(x) protocol state.', { exact: true })).toHaveCount(0);
    assertNoBackendRequests(requests);
  });

  test('disconnected settings do not expose a session disconnect card', async ({ page, requests }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name: /^(Connect|Retry wallet provider)/ })).toBeVisible();
    await expect(page.getByText('Session', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /sign out|log out/i })).toHaveCount(0);
    assertNoBackendRequests(requests);
  });

  test.describe('connected browser wallet', () => {
    test.use({
      browserWallet: {
        address: '0x930f0000000000000000000000000000000098b9',
        initiallyConnected: true,
      },
    });

    test('connected settings preserve wallet controls and expose a reachable session exit', async ({ page, requests }) => {
      await page.goto('/settings', { waitUntil: 'domcontentloaded' });
      const account = page.getByRole('button', { name: /View connected account/ });
      await expect(account).toBeVisible();
      await account.click();
      const profile = page.getByRole('dialog');
      await expect(profile.getByRole('heading', { level: 2 })).toHaveText('0x930f…98b9');
      await expect(profile.getByRole('link', { name: 'View on Etherscan' })).toHaveAttribute('href', /etherscan\.io\/address\/0x930f/i);
      await profile.getByRole('button', { name: 'Close wallet profile' }).click();
      const changeWallet = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Change wallet' }) });
      await changeWallet.locator('summary').click();
      await expect(changeWallet.getByRole('button', { name: 'Reconnect wallet', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Disconnect wallet', exact: true })).toBeVisible();
      assertNoBackendRequests(requests);
    });
  });
});
