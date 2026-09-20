import { expect, test, assertNoBackendRequests } from '../fixtures/test';
import type { Page, TestInfo } from '@playwright/test';

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
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');

    await setAccounts(page, []);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.app-topbar').getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
    await expect.poll(() => page.locator('body').evaluate((body) => body.style.overflow)).toBe('');

    await setAccounts(page, [ACCOUNT_A]);
    await expect(page.getByRole('button', { name: 'Open wallet profile' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'Open wallet profile' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await setAccounts(page, [ACCOUNT_B]);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open wallet profile' })).toContainText('0x440');
    await expect.poll(() => page.locator('body').evaluate((body) => body.style.overflow)).toBe('');
    assertNoBackendRequests(requests);
  });

  test('wallet profile disconnects in place and can reconnect deliberately', async ({ page, requests }) => {
    await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Open wallet profile' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Disconnect wallet', exact: true })).toBeVisible();
    await expect(dialog).not.toContainText(/\$[\d,.]+ each\b/);

    await dialog.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/portfolio\/?$/);
    await expect(page.locator('.app-topbar').getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
    await expect.poll(() => page.locator('body').evaluate((body) => body.style.overflow)).toBe('');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-topbar').getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
    await page.locator('.app-topbar').getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open wallet profile' })).toBeVisible();
    assertNoBackendRequests(requests);
  });

  test('mobile wallet profile keeps the address fallback when ENS and wallet reads are unavailable', async ({ page, requests }, testInfo: TestInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Open wallet profile' }).click();
    const profile = page.getByRole('dialog', { name: `Wallet ${ACCOUNT_A}`, exact: true });
    await expect(profile).toBeVisible();
    await expect(profile.getByRole('heading', { level: 2 })).toHaveText('0x930f…98b9');
    await expect(profile.getByText('Wallet value', { exact: true })).toBeVisible();

    // The deterministic E2E build has no RPC endpoint or ENS gateway. Wait for
    // the honest unavailable state, then ensure the drawer still identifies
    // the connected address rather than blocking on reverse-name lookup.
    await expect(profile.getByRole('status', { name: 'Wallet value unavailable because no priced balances are available' })).toBeVisible({ timeout: 20_000 });
    await expect(profile.getByRole('heading', { level: 2 })).toHaveText('0x930f…98b9');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { __wallet: { requests: Array<{ method: string }> } }).__wallet.requests.some((request) => request.method === 'eth_sendTransaction'))).toBe(false);

    const screenshot = await page.screenshot({ fullPage: false, animations: 'disabled' });
    await testInfo.attach('wallet-profile-mobile', { body: screenshot, contentType: 'image/png' });
    assertNoBackendRequests(requests);
  });

  test('history never relabels a prior wallet receipt after an account switch', async ({ page, requests }) => {
    await page.addInitScript(({ accountA, accountB }) => {
      const hashA = `0x${'a'.repeat(64)}`;
      const hashB = `0x${'b'.repeat(64)}`;
      localStorage.setItem('fxaeon:pending-hashes:v4', JSON.stringify([
        { id: `1:${accountA.toLowerCase()}:${hashA}`, operation: 'increasePosition', walletAddress: accountA, chainId: 1, hash: hashA, to: '0x2222222222222222222222222222222222222222', nonce: 1, dataHash: hashA, valueWei: '0', submittedAt: 1, status: 'pending' },
        { id: `1:${accountB.toLowerCase()}:${hashB}`, operation: 'depositFxSave', walletAddress: accountB, chainId: 1, hash: hashB, to: '0x3333333333333333333333333333333333333333', nonce: 2, dataHash: hashB, valueWei: '0', submittedAt: 2, status: 'pending' },
      ]));
    }, { accountA: ACCOUNT_A, accountB: ACCOUNT_B });
    await page.goto('/history', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Opened or increased position', { exact: true })).toBeVisible();
    await expect(page.getByText('Deposit Fx Save', { exact: true })).toHaveCount(0);

    await setAccounts(page, [ACCOUNT_B]);
    await expect(page.getByText('Deposit Fx Save', { exact: true })).toBeVisible();
    await expect(page.getByText('Opened or increased position', { exact: true })).toHaveCount(0);
    assertNoBackendRequests(requests);
  });

  test('keeps unsigned resume drafts collapsed and separate from submitted receipts', async ({ page, requests }) => {
    await page.addInitScript((account) => {
      const wallet = account.toLowerCase();
      const activeActionKey = 'borrow-small';
      const dismissedActionKey = 'discarded-position';
      const activePath = '/borrow';
      const dismissedPath = '/positions';
      const draft = (operation: string, actionKey: string, resumePath: string, status: 'signature-required' | 'cancelled') => ({
        id: `1:${wallet}:${operation}:${encodeURIComponent(actionKey)}:${encodeURIComponent(resumePath)}`,
        walletAddress: account,
        chainId: 1,
        operation,
        actionKey,
        resumePath,
        createdAt: 100,
        updatedAt: 100,
        status,
      });
      localStorage.setItem('fxaeon:signature-drafts:v1', JSON.stringify([
        draft('depositAndMint', activeActionKey, activePath, 'signature-required'),
        draft('increasePosition', dismissedActionKey, dismissedPath, 'cancelled'),
      ]));

      const hash = `0x${'c'.repeat(64)}`;
      localStorage.setItem('fxaeon:pending-hashes:v4', JSON.stringify([
        { id: `1:${wallet}:${hash}`, operation: 'increasePosition', walletAddress: account, chainId: 1, hash, to: '0x2222222222222222222222222222222222222222', nonce: 1, dataHash: hash, valueWei: '0', submittedAt: 1, status: 'pending' },
      ]));
    }, ACCOUNT_A);

    await page.goto('/history', { waitUntil: 'domcontentloaded' });
    const draftSummary = page.getByText('Drafts (1)', { exact: true });
    await expect(draftSummary).toBeVisible();
    await expect(page.getByRole('link', { name: 'Continue', exact: true })).toBeHidden();
    await expect(page.getByText('Borrow fxUSD', { exact: true })).toBeHidden();
    await expect(page.getByText('Submitted transactions', { exact: true })).toBeVisible();
    await expect(page.getByText('Opened or increased position', { exact: true })).toBeVisible();
    await expect(page.getByText('Minted fxUSD', { exact: true })).toHaveCount(0);

    await draftSummary.click();
    await expect(page.getByRole('link', { name: 'Continue', exact: true })).toBeVisible();
    await expect(page.getByText('Borrow fxUSD', { exact: true })).toBeVisible();
    await expect(page.getByText('Unsubmitted', { exact: true })).toBeVisible();
    await expect(page.getByText('Opened or increased position', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(page.getByText('Drafts (1)', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Continue', exact: true })).toHaveCount(0);
    await expect(page.getByText('Opened or increased position', { exact: true })).toBeVisible();
    assertNoBackendRequests(requests);
  });
});
