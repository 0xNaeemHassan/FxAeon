import { expect, test, assertNoBackendRequests } from '../fixtures/test';

test.describe('product copy and session visibility', () => {
  test.use({ telegram: false });

  test('landing page uses the concise product copy and credits whiz', async ({ page, requests }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /your next move/i })).toBeVisible();
    await expect(page.getByText(/all in one place/i)).toBeVisible();
    await expect(page.getByText(/all from your wallet/i)).toHaveCount(0);
    await expect(page.getByText('Your assets. Your wallet. Your call.', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Made for the way you move.', { exact: true })).toHaveCount(0);
    const whiz = page.getByRole('link', { name: /Made by whiz/ });
    await expect(whiz).toBeVisible();
    await expect(whiz).toContainText('❤️');
    await expect(whiz).toHaveAttribute('href', 'https://x.com/0xWhizMiz');
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
    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
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

    test('connected settings preserve wallet controls without a false session card', async ({ page, requests }) => {
      await page.goto('/settings', { waitUntil: 'domcontentloaded' });
      const address = page.getByRole('button', { name: 'Copy wallet address 0x930f…98b9', exact: true });
      await expect(address).toBeVisible();
      await expect(address).toHaveAttribute('title', '0x930f0000000000000000000000000000000098b9');
      await expect(page.getByRole('button', { name: 'Reconnect wallet', exact: true })).toBeVisible();
      await expect(page.getByText('Session', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /sign out|log out/i })).toHaveCount(0);
      assertNoBackendRequests(requests);
    });
  });
});
