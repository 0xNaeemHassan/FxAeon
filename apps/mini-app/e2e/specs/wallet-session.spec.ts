import { expect, test, assertNoBackendRequests } from '../fixtures/test';
import type { Page } from '@playwright/test';

const ACCOUNT_A = '0x930f0000000000000000000000000000000098b9';
const ACCOUNT_B = '0x440f000000000000000000000000000000001234';

async function setAccounts(page: Page, accounts: string[]) {
  await page.evaluate((next) => {
    const controls = (window as unknown as { __wallet: { setAccounts: (value: string[]) => void } }).__wallet;
    controls.setAccounts(next);
  }, accounts);
}

test.describe('wallet session isolation', () => {
  test.use({ telegram: false, browserWallet: { address: ACCOUNT_A, initiallyConnected: true } });

  test('disconnect and account switch close the wallet drawer and restore scrolling', async ({ page, requests }) => {
    await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Open wallet profile' }).click();
    await expect(page.getByRole('dialog', { name: 'Wallet profile' })).toBeVisible();
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');

    await setAccounts(page, []);
    await expect(page.getByRole('dialog', { name: 'Wallet profile' })).toHaveCount(0);
    await expect(page.locator('.app-topbar').getByRole('link', { name: 'Connect wallet', exact: true })).toBeVisible();
    await expect.poll(() => page.locator('body').evaluate((body) => body.style.overflow)).toBe('');

    await setAccounts(page, [ACCOUNT_A]);
    await expect(page.getByRole('button', { name: 'Open wallet profile' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Wallet profile' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Open wallet profile' }).click();
    await expect(page.getByRole('dialog', { name: 'Wallet profile' })).toBeVisible();
    await setAccounts(page, [ACCOUNT_B]);
    await expect(page.getByRole('dialog', { name: 'Wallet profile' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open wallet profile' })).toContainText('0x440');
    await expect.poll(() => page.locator('body').evaluate((body) => body.style.overflow)).toBe('');
    assertNoBackendRequests(requests);
  });

  test('activity never relabels a prior wallet receipt after an account switch', async ({ page, requests }) => {
    await page.addInitScript(({ accountA, accountB }) => {
      const hashA = `0x${'a'.repeat(64)}`;
      const hashB = `0x${'b'.repeat(64)}`;
      localStorage.setItem('fxaeon:pending-hashes:v4', JSON.stringify([
        { id: `1:${accountA.toLowerCase()}:${hashA}`, operation: 'increasePosition', walletAddress: accountA, chainId: 1, hash: hashA, to: '0x2222222222222222222222222222222222222222', nonce: 1, dataHash: hashA, valueWei: '0', submittedAt: 1, status: 'pending' },
        { id: `1:${accountB.toLowerCase()}:${hashB}`, operation: 'depositFxSave', walletAddress: accountB, chainId: 1, hash: hashB, to: '0x3333333333333333333333333333333333333333', nonce: 2, dataHash: hashB, valueWei: '0', submittedAt: 2, status: 'pending' },
      ]));
    }, { accountA: ACCOUNT_A, accountB: ACCOUNT_B });
    await page.goto('/activity', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Increase Position', { exact: true })).toBeVisible();
    await expect(page.getByText('Deposit Fx Save', { exact: true })).toHaveCount(0);

    await setAccounts(page, [ACCOUNT_B]);
    await expect(page.getByText('Deposit Fx Save', { exact: true })).toBeVisible();
    await expect(page.getByText('Increase Position', { exact: true })).toHaveCount(0);
    assertNoBackendRequests(requests);
  });
});
