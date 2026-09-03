import { test, expect, assertNoBackendRequests } from '../fixtures/test';

test.describe('Earn entry and honest unavailable state', () => {
  test.use({ telegram: false });

  test('disconnected users get a clear wallet entry without dead claim actions', async ({ page, requests }) => {
    await page.goto('/earn', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Earn' })).toBeVisible();
    await expect(page.getByText('Choose or connect a wallet to view your fxSAVE balance and manage withdrawals.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Borrow / fxMINT' })).toBeVisible();
    await expect(page.getByRole('button', { name: /review claim/i })).toHaveCount(0);
    await expect(page.getByText(/claim success|claimed successfully/i)).toHaveCount(0);
    assertNoBackendRequests(requests);
  });
});
