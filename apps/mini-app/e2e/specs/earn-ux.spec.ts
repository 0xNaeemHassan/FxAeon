import { test, expect, assertNoBackendRequests } from '../fixtures/test';

test.describe('Earn entry and honest unavailable state', () => {
  test.use({ telegram: false });

  test('disconnected users can edit the earn form and enter through its review action', async ({ page, requests }) => {
    await page.goto('/earn', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Earn' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Borrow fxUSD' })).toBeVisible();
    await expect(page.getByLabel('Deposit amount in fxUSD')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).last()).toBeVisible();
    await expect(page.getByRole('button', { name: /review claim/i })).toHaveCount(0);
    await expect(page.getByText(/claim success|claimed successfully/i)).toHaveCount(0);
    assertNoBackendRequests(requests);
  });

  test('mobile withdrawal keeps the method switch and consequence copy visible', async ({ page, requests }) => {
    await page.setViewportSize({ width: 390, height: 500 });
    await page.goto('/earn', { waitUntil: 'domcontentloaded' });
    await page.getByRole('radio', { name: 'Withdraw', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Withdraw', exact: true })).toBeVisible();
    await expect(page.getByRole('switch', { name: /Withdraw instantly/ })).toBeVisible();
    await expect(page.getByText(/cooldown|fee|queue/i).first()).toBeVisible();
    await expect(page.getByLabel('fxSAVE to withdraw in fxSAVE')).toBeVisible();
    assertNoBackendRequests(requests);
  });
});
