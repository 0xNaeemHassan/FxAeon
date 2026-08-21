import { test, expect } from '../fixtures/test';
import { bridgeState, onboardedMe, protocolInfo, TX_HASH } from '../fixtures/data';

test.describe('Earn gateway', () => {
  test('quotes a live fxSAVE deposit from protocol state', async ({ page, api }) => {
    await page.goto('/earn');
    await expect(page.getByText('1.025 fxUSD', { exact: true })).toBeVisible();
    await expect(page.getByText('24h', { exact: true })).toBeVisible();
    await expect(page.getByText('0.25%', { exact: true })).toBeVisible();

    await page.getByLabel('Amount in fxUSD').fill('250');
    await page.getByRole('button', { name: 'Review deposit' }).click();
    await expect(page.getByText('Deposit to fxSAVE', { exact: true })).toBeVisible();
    expect(api.lastRequest('POST', '/action/quote')?.body).toEqual({
      kind: 'save_deposit',
      tokenIn: 'fxUSD',
      amount: '250',
    });
  });

  test('supports queued withdrawal and claim intents', async ({ page, api }) => {
    await page.goto('/earn');
    await expect(page.getByText('Deposit assets')).toBeVisible();
    await page.getByRole('radio', { name: 'Withdraw' }).click();
    await page.getByRole('button', { name: 'MAX' }).click();
    await page.getByRole('switch', { name: /Instant redemption/ }).click();
    await page.getByRole('button', { name: 'Review redemption' }).click();
    await expect(page.getByText('Queue fxSAVE redemption', { exact: true })).toBeVisible();
    expect(api.lastRequest('POST', '/action/quote')?.body).toEqual({
      kind: 'save_withdraw',
      tokenOut: 'fxUSD',
      shares: 'all',
      instant: false,
    });

    const claimable = structuredClone(onboardedMe);
    if (!claimable.savings) throw new Error('claim fixture requires savings');
    claimable.savings.pendingRedeem = true;
    claimable.savings.redeemReady = true;
    claimable.savings.pendingShares = '300';
    api.setMe(claimable);
    await page.goto('/earn');
    await page.getByRole('radio', { name: 'Claim' }).click();
    await expect(page.getByText('Redemption ready')).toBeVisible();
    await page.getByRole('button', { name: 'Review claim' }).click();
    await expect(page.getByText('Claim fxSAVE redemption', { exact: true })).toBeVisible();
    expect(api.lastRequest('POST', '/action/quote')?.body).toEqual({ kind: 'save_claim' });
  });

  test('exposes a working retry when live savings data fails', async ({ page, api }) => {
    api.fail('GET', '/protocol', 503, 'UPSTREAM', 'Protocol state is temporarily unavailable.');
    await page.goto('/earn');
    await expect(page.getByText('Savings data unavailable')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();

    api.set('GET', '/protocol', { status: 200, body: protocolInfo });
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText('Deposit assets')).toBeVisible();
  });
});

test.describe('Borrow gateway', () => {
  test('mints fxUSD against a new collateral position', async ({ page, api }) => {
    await page.goto('/borrow');
    await expect(page.getByText('Borrow without selling')).toBeVisible();
    await page.getByLabel('Collateral amount in ETH').fill('0.5');
    await page.getByLabel('Mint amount in fxUSD').fill('600');
    await page.getByRole('button', { name: 'Review mint' }).click();
    await expect(page.getByRole('heading', { name: 'Mint fxUSD', exact: true })).toBeVisible();
    expect(api.lastRequest('POST', '/action/quote')?.body).toEqual({
      kind: 'mint',
      market: 'wstETH',
      positionId: 0,
      depositToken: 'ETH',
      depositAmount: '0.5',
      mintAmount: '600',
    });
  });

  test('repays all debt without forcing a collateral withdrawal', async ({ page, api }) => {
    await page.goto('/borrow');
    await expect(page.getByText('Borrow without selling')).toBeVisible();
    await page.getByRole('radio', { name: 'Repay & release' }).click();
    await expect(page.getByText('500.00 fxUSD', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'MAX' }).click();
    await page.getByRole('button', { name: 'Review repayment' }).click();
    await expect(page.getByText('Repay and release collateral', { exact: true })).toBeVisible();
    expect(api.lastRequest('POST', '/action/quote')?.body).toEqual({
      kind: 'repay_withdraw',
      market: 'wstETH',
      positionId: 1,
      repayAmount: 'all',
      withdrawToken: 'ETH',
      withdrawAmount: '0',
    });
  });

  test('distinguishes pool-scoped positions when token IDs collide', async ({ page, api }) => {
    const colliding = structuredClone(onboardedMe);
    colliding.positions = [
      ...(colliding.positions ?? []),
      {
        tokenId: '1',
        market: 'WBTC',
        side: 'long',
        collateral: '0.02',
        collateralToken: 'WBTC',
        debt: '400',
        debtToken: 'fxUSD',
        leverage: 2,
        healthPercent: 0.7,
      },
    ];
    api.setMe(colliding);

    await page.goto('/borrow');
    await page.getByRole('radio', { name: 'Repay & release' }).click();
    await page.getByLabel('Position to manage').selectOption('WBTC:1');
    await page.getByLabel('Repay fxUSD in fxUSD').fill('10');
    await page.getByRole('button', { name: 'Review repayment' }).click();

    expect(api.lastRequest('POST', '/action/quote')?.body).toEqual({
      kind: 'repay_withdraw',
      market: 'WBTC',
      positionId: 1,
      repayAmount: '10',
      withdrawToken: 'WBTC',
      withdrawAmount: '0',
    });
  });
});

test.describe('Position management', () => {
  test('uses short-market leverage bounds and builds an exact close intent', async ({ page, api }) => {
    await page.goto('/positions');
    await expect(page.getByText('82%', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /WBTC short/ }).click();
    await expect(page.getByText('41%', { exact: true })).toBeVisible();

    await page.getByRole('radio', { name: 'Leverage' }).click();
    await expect(page.getByRole('slider', { name: 'Target leverage' })).toHaveAttribute('max', '3');

    await page.getByRole('radio', { name: 'Reduce' }).click();
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Review close' }).click();
    await expect(page.getByText('Close WBTC position', { exact: true })).toBeVisible();
    expect(api.lastRequest('POST', '/action/quote')?.body).toEqual({
      kind: 'position_reduce',
      market: 'WBTC',
      side: 'short',
      positionId: 2,
      outputToken: 'WBTC',
      fractionBps: 10_000,
    });
  });
});

test.describe('Cross-chain gateway', () => {
  test('quotes both directions and uses BaseScan for a Base-source transaction', async ({ page, api }) => {
    await page.goto('/move');
    await expect(page.getByLabel('Ethereum source bridge wallet state')).toContainText('850 fxUSD');
    await expect(page.getByLabel('Ethereum source bridge wallet state')).toContainText('0.125 ETH gas');
    await expect(page.getByLabel('Base destination bridge wallet state')).toContainText('90.5 fxUSD');
    await expect(page.getByLabel('Base destination bridge wallet state')).toContainText('0.03125 ETH gas');
    await page.getByLabel('Amount on Ethereum in fxUSD').fill('25');
    await page.getByRole('button', { name: 'Review bridge to Base' }).click();
    await expect(page.getByText('Bridge fxUSD to Base', { exact: true })).toBeVisible();
    await expect(page.getByText('Ethereum', { exact: true }).last()).toBeVisible();
    expect(api.lastRequest('POST', '/action/quote')?.body).toEqual({
      kind: 'bridge',
      token: 'fxUSD',
      amount: '25',
      direction: 'ethereum_to_base',
    });

    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('radio', { name: /To Ethereum/ }).click();
    await expect(page.getByText('Bridge Base → Ethereum')).toBeVisible();
    await expect(page.getByLabel('Base source bridge wallet state')).toContainText('90.5 fxUSD');
    await expect(page.getByLabel('Base source bridge wallet state')).toContainText('0.03125 ETH gas');
    await page.getByRole('button', { name: 'Review bridge to Ethereum' }).click();
    await expect(page.getByText('Bridge fxUSD to Ethereum', { exact: true })).toBeVisible();
    await expect(page.getByText('Base', { exact: true }).last()).toBeVisible();
    expect(api.lastRequest('POST', '/action/quote')?.body).toEqual({
      kind: 'bridge',
      token: 'fxUSD',
      amount: '25',
      direction: 'base_to_ethereum',
    });

    await page.getByRole('button', { name: /Confirm and execute/ }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed on-chain' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /BaseScan/ }).click();
    const opened = await page.evaluate(() =>
      (window as unknown as { __tg: { record: Record<string, unknown[]> } }).__tg.record.openLink
    );
    expect(opened).toContain(`https://basescan.org/tx/${TX_HASH}`);
  });

  test('shows live balances but fails closed while execution is paused', async ({ page, api }) => {
    api.setBridgeState({ ...structuredClone(bridgeState), enabled: false });
    await page.goto('/move');

    await expect(page.getByText('Bridge execution paused', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Ethereum source bridge wallet state')).toContainText('850 fxUSD');
    await page.getByLabel('Amount on Ethereum in fxUSD').fill('25');
    await expect(page.getByRole('button', { name: 'Review bridge to Base' })).toBeDisabled();
    expect(api.lastRequest('POST', '/action/quote')).toBeUndefined();
  });

  test('distinguishes an unknown Base source from a zero balance and retries it', async ({ page, api }) => {
    const unavailable = structuredClone(bridgeState);
    unavailable.base = {
      chainId: 8453,
      known: false,
      native: null,
      assets: { fxUSD: null, fxSAVE: null },
    };
    api.setBridgeState(unavailable);
    await page.goto('/move');
    await page.getByRole('radio', { name: /To Ethereum/ }).click();

    await expect(page.getByText('Base balance unavailable', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Base source bridge wallet state')).toContainText('Balance unavailable');
    await page.getByLabel('Amount on Base in fxUSD').fill('1');
    await expect(page.getByRole('button', { name: 'Review bridge to Ethereum' })).toBeDisabled();

    api.setBridgeState(structuredClone(bridgeState));
    await page.getByRole('button', { name: 'Retry Base' }).click();
    await expect(page.getByLabel('Base source bridge wallet state')).toContainText('90.5 fxUSD');
    await expect(page.getByRole('button', { name: 'Review bridge to Ethereum' })).toBeEnabled();
  });

  test('fails closed when the destination chain cannot be verified', async ({ page, api }) => {
    const unavailable = structuredClone(bridgeState);
    unavailable.base = {
      chainId: 8453,
      known: false,
      native: null,
      assets: { fxUSD: null, fxSAVE: null },
    };
    api.setBridgeState(unavailable);
    await page.goto('/move');

    await expect(page.getByText('Base destination unavailable', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Base destination bridge wallet state')).toContainText('Balance unavailable');
    await page.getByLabel('Amount on Ethereum in fxUSD').fill('1');
    await expect(page.getByRole('button', { name: 'Review bridge to Base' })).toBeDisabled();
    expect(api.lastRequest('POST', '/action/quote')).toBeUndefined();
  });

  test('blocks insufficient token balance and missing source gas with explicit copy', async ({ page, api }) => {
    await page.goto('/move');
    const amount = page.getByLabel('Amount on Ethereum in fxUSD');
    await amount.fill('850.000000000000000001');
    await expect(page.getByRole('alert').filter({ hasText: 'Amount exceeds your 850 fxUSD balance on Ethereum.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review bridge to Base' })).toBeDisabled();

    const noGas = structuredClone(bridgeState);
    noGas.ethereum.native = '0';
    api.setBridgeState(noGas);
    await page.reload();
    await expect(page.getByText('Add ETH for gas on Ethereum', { exact: true })).toBeVisible();
    await page.getByLabel('Amount on Ethereum in fxUSD').fill('1');
    await expect(page.getByRole('button', { name: 'Review bridge to Base' })).toBeDisabled();
  });

  test('keeps the bridge disabled when readiness itself cannot be loaded', async ({ page, api }) => {
    api.fail('GET', '/bridge-state', 503, 'BRIDGE_STATE_UNAVAILABLE', 'Bridge state is unavailable.');
    await page.goto('/move');
    await expect(page.getByText('Bridge readiness unavailable', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review bridge to Base' })).toBeDisabled();

    api.set('GET', '/bridge-state', { status: 200, body: bridgeState });
    await page.getByRole('button', { name: 'Retry readiness' }).click();
    await expect(page.getByLabel('Ethereum source bridge wallet state')).toContainText('850 fxUSD');
  });
});

test.describe('Activity journal', () => {
  test('labels protocol actions and opens the explorer for each source chain', async ({ page }) => {
    await page.goto('/activity');
    await expect(page.getByText('Opened long')).toBeVisible();
    await expect(page.getByText('Bridged to Ethereum')).toBeVisible();
    await expect(page.getByText('Started fxSAVE redemption')).toBeVisible();

    await page.getByRole('button', { name: 'Open transaction in Etherscan' }).click();
    await page.getByRole('button', { name: 'Open transaction in BaseScan' }).click();
    const opened = await page.evaluate(() =>
      (window as unknown as { __tg: { record: Record<string, unknown[]> } }).__tg.record.openLink
    );
    expect(opened).toEqual([
      `https://etherscan.io/tx/${TX_HASH}`,
      `https://basescan.org/tx/${'0x' + 'cd'.repeat(32)}`,
    ]);
  });
});

test('all gateway routes fit the 390px mobile viewport without horizontal overflow', async ({ page }) => {
  for (const path of ['/trade', '/earn', '/borrow', '/positions', '/move', '/more', '/activity']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(1);
  }
});
