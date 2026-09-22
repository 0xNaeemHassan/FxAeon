import { test, expect, assertNoBackendRequests } from '../fixtures/test';

test.describe('Earn entry and honest unavailable state', () => {
  test.use({ telegram: false });

  test('disconnected users can edit the earn form and enter through its review action', async ({ page, requests }) => {
    await page.goto('/earn', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Earn' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Borrow fxUSD' })).toBeVisible();
    const amount = page.getByLabel('Deposit amount in fxUSD');
    await expect(amount).toBeVisible();
    await expect(amount).toBeEnabled();
    await amount.fill('112');
    await expect(amount).toHaveValue('112');
    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).last()).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Claim', exact: true })).toHaveCount(0);
    await expect(page.getByText(/claim success|claimed successfully/i)).toHaveCount(0);
    assertNoBackendRequests(requests);
  });

  test('mobile withdrawal explains both methods without compressing the form', async ({ page, requests }) => {
    await page.setViewportSize({ width: 390, height: 500 });
    await page.goto('/earn', { waitUntil: 'domcontentloaded' });
    const withdraw = page.getByRole('radio', { name: 'Withdraw', exact: true });
    await withdraw.click();
    await expect(withdraw).toHaveAttribute('aria-checked', 'true');
    const methods = page.getByRole('radiogroup', { name: 'Withdrawal method' });
    await expect(methods).toBeVisible();
    const cooldown = methods.getByRole('radio', { name: /After cooldown/ });
    const instant = methods.getByRole('radio', { name: /Without cooldown/ });
    await expect(cooldown).toBeVisible();
    await expect(instant).toBeVisible();
    await cooldown.click();
    await expect(cooldown).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText(/claimed later/i)).toBeVisible();
    const amount = page.getByLabel('fxSAVE to withdraw in fxSAVE');
    await expect(amount).toBeVisible();
    await expect(amount).toBeEnabled();
    await amount.fill('1.25');
    await expect(amount).toHaveValue('1.25');
    const overflow = await page.getByRole('main').evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    assertNoBackendRequests(requests);
  });

  test('claim deep links remain available without a permanent empty tab', async ({ page, requests }) => {
    await page.goto('/earn?mode=claim', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Withdrawal', exact: true })).toBeVisible();
    await expect(page.getByText('Connect the requesting wallet to view its withdrawal.')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Claim', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to fxSAVE' }).click();
    await expect(page.getByRole('radio', { name: 'Withdraw', exact: true })).toHaveAttribute('aria-checked', 'true');
    assertNoBackendRequests(requests);
  });
});
