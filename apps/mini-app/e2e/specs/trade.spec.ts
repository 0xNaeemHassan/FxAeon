import { test, expect } from '../fixtures/test';
import { actionExecuteDeduped, TX_HASH } from '../fixtures/data';

/** The Trade page now uses the same wallet-scoped intent engine as every f(x) action. */
test.describe('Trade action flow', () => {
  test('builds an intent, reviews live gas, executes once, and opens Etherscan', async ({ page, api }) => {
    await page.goto('/trade');
    await page.getByLabel('Input amount in ETH').fill('1');
    await expect(page.getByText('1 ETH', { exact: true })).toBeVisible();
    await expect(page.getByText('Funding amount · final market exposure comes only from the live SDK route')).toBeVisible();

    await page.getByRole('button', { name: 'Review wstETH long' }).click();
    await expect(page.getByText('Open wstETH long', { exact: true })).toBeVisible();
    await expect(page.getByText('1 ETH', { exact: true })).toBeVisible();
    await expect(page.getByText('3x', { exact: true })).toBeVisible();
    await expect(page.getByText('Ethereum', { exact: true })).toBeVisible();

    expect(api.lastRequest('POST', '/action/quote')?.body).toEqual({
      kind: 'position_open',
      market: 'wstETH',
      side: 'long',
      inputToken: 'ETH',
      amount: '1',
      leverage: 3,
    });

    await page.getByRole('radio', { name: /^fast/i }).click();
    await page.getByRole('button', { name: /Confirm and execute/ }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed on-chain' })).toBeVisible({ timeout: 15_000 });

    const executeBody = api.lastRequest('POST', '/action/execute')?.body as Record<string, unknown>;
    expect(executeBody).toEqual({
      ticket: 'E'.repeat(43),
      feeTier: 'fast',
    });

    await page.getByRole('button', { name: /View on Etherscan/ }).click();
    const opened = await page.evaluate(() =>
      (window as unknown as { __tg: { record: Record<string, unknown[]> } }).__tg.record.openLink
    );
    expect(opened).toContain(`https://etherscan.io/tx/${TX_HASH}`);
  });

  test('surfaces an idempotent broadcast result without claiming confirmation', async ({ page, api }) => {
    api.setExecute(actionExecuteDeduped);
    await page.goto('/trade');
    await page.getByLabel('Input amount in ETH').fill('1');
    await page.getByRole('button', { name: 'Review wstETH long' }).click();
    await page.getByRole('button', { name: /Confirm and execute/ }).click();

    await expect(page.getByRole('heading', { name: 'Transaction submitted' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Current status: broadcast. Track it from Activity.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Confirmed on-chain' })).toHaveCount(0);
  });

  test('signer-policy rejection keeps the live review and links to Settings', async ({ page, api }) => {
    api.fail('POST', '/action/execute', 403, 'BOT_TRADING_OFF', 'Bot trading is not enabled for this wallet.');
    await page.goto('/trade');
    await page.getByLabel('Input amount in ETH').fill('1');
    await page.getByRole('button', { name: 'Review wstETH long' }).click();
    await page.getByRole('button', { name: /Confirm and execute/ }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'Bot trading is not enabled' })).toContainText(
      'Bot trading is not enabled for this wallet.'
    );
    await expect(page.getByRole('link', { name: 'Enable signer access' })).toHaveAttribute('href', '/settings');
    await expect(page.getByText('Open wstETH long', { exact: true })).toBeVisible();
  });

  test('quote failure stays on the builder and never fabricates review data', async ({ page, api }) => {
    api.fail('POST', '/action/quote', 502, 'QUOTE_FAILED', 'Upstream route builder is unavailable.');
    await page.goto('/trade');
    await page.getByLabel('Input amount in ETH').fill('1');
    await page.getByRole('button', { name: 'Review wstETH long' }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'Upstream route builder' })).toContainText(
      'Upstream route builder is unavailable.'
    );
    await expect(page.getByRole('button', { name: 'Review wstETH long' })).toBeVisible();
    await expect(page.getByText('Final review')).toHaveCount(0);
  });

  test('confirms the frozen intent that produced the visible review', async ({ page, api }) => {
    await page.goto('/trade');
    const amount = page.getByLabel('Input amount in ETH');
    await amount.fill('1');
    await page.getByRole('button', { name: 'Review wstETH long' }).click();
    await expect(page.getByRole('heading', { name: 'Open wstETH long' })).toBeVisible();

    // Parent form controls remain mounted above the review. Mutating them must
    // not execute a new intent under the already-rendered quote.
    await amount.fill('2');
    await page.getByRole('button', { name: /Confirm and execute/ }).click();

    const executeBody = api.lastRequest('POST', '/action/execute')?.body as Record<string, unknown>;
    expect(executeBody).toEqual({ ticket: 'E'.repeat(43), feeTier: 'market' });
    expect(api.lastRequest('POST', '/action/quote')?.body).toMatchObject({
      amount: '1', leverage: 3, inputToken: 'ETH',
    });
  });

  test('rejects exponent and over-precision input but preserves a huge exact decimal', async ({ page, api }) => {
    await page.goto('/trade');
    const amount = page.getByLabel('Input amount in ETH');
    const review = page.getByRole('button', { name: 'Review wstETH long' });

    await amount.fill('1e6');
    await amount.blur();
    await expect(page.getByRole('alert')).toHaveText('Enter a plain decimal number.');
    await expect(review).toBeDisabled();

    await amount.fill('0.1234567890123456789');
    await expect(page.getByRole('alert')).toHaveText('18-decimal precision maximum for this asset.');
    await expect(review).toBeDisabled();

    const exact = '9007199254740993.123456789012345678';
    await amount.fill(exact);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await review.click();
    expect(api.lastRequest('POST', '/action/quote')?.body).toMatchObject({ amount: exact });
    await expect(page.getByText(`${exact} ETH`, { exact: true })).toBeVisible();
  });
});
