import { test, expect } from '@playwright/test';
import { openHarness, metric } from '../harness/action-review-measurement-support';
import { readReviewedTransactions } from '../fork/reviewedTransactions';
async function harnessMetrics(page: import('@playwright/test').Page): Promise<Record<string, unknown>> {
  return page.locator('[data-metrics]').evaluate((node) => JSON.parse(node.textContent || '{}') as Record<string, unknown>);
}
type PreviewRequestSnapshot = {
  id: number;
  routeVersion: number;
  routeType: string;
  routeWalletAddress: string;
  previewWalletAddress: string;
  connectionVersion: number;
  settled: boolean;
};

async function previewRequests(page: import('@playwright/test').Page): Promise<PreviewRequestSnapshot[]> {
  return page.evaluate(() => {
    const harness = (window as typeof window & { __actionReviewHarness?: { previewRequests?: PreviewRequestSnapshot[] } }).__actionReviewHarness;
    return (harness?.previewRequests ?? []).map(({ id, routeVersion, routeType, routeWalletAddress, previewWalletAddress, connectionVersion, settled }) => ({
      id, routeVersion, routeType, routeWalletAddress, previewWalletAddress, connectionVersion, settled,
    }));
  });
}

async function resolvePreviewRequest(page: import('@playwright/test').Page, requestId: number): Promise<void> {
  const resolved = await page.evaluate((id) => {
    const harness = (window as typeof window & {
      __actionReviewHarness?: { previewRequests?: Array<{ id: number; settled: boolean; resolve: () => void }> };
    }).__actionReviewHarness;
    const request = harness?.previewRequests?.find((candidate) => candidate.id === id);
    if (!request || request.settled) return false;
    request.resolve();
    return true;
  }, requestId);
  expect(resolved, `preview request ${requestId} should be pending before resolution`).toBe(true);
}

test.describe('ActionReview isolated orchestration', () => {
  test('renders each reviewed transaction once in Steps with exact wei and calldata', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
    await openHarness(page);
    await page.getByRole('button', { name: 'Use approval route', exact: true }).click();
    await page.getByRole('button', { name: 'Use multi-step route', exact: true }).click();
    await page.getByRole('button', { name: 'Use nonzero transaction values', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();

    const review = page.locator('.reviewInlineContent');
    const stepsSummary = review.getByText('Steps · 3', { exact: true });
    await expect(stepsSummary).toBeHidden();
    await expect(review.locator('details[aria-label="Review details"]')).toHaveJSProperty('open', false);
    const advanced = review.locator('details').filter({ has: review.getByText('Advanced details', { exact: true }) });
    await expect(advanced).toHaveCount(0);
    await expect(review.getByText('Prepared transactions', { exact: true })).toHaveCount(0);
    const reviewed = await readReviewedTransactions(review, { collapseAfterRead: false });
    expect(reviewed.map((transaction) => transaction.heading)).toEqual(['Approve fxUSD 1', 'Confirm 2', 'Confirm 3']);
    expect(reviewed.map((transaction) => transaction.status)).toEqual(['Ready', 'Ready', 'Ready']);
    expect(reviewed.some((transaction) => transaction.status === 'Confirmed')).toBe(false);
    expect(reviewed.map((transaction) => transaction.valueWei)).toEqual(['0', '123', '456']);
    expect(reviewed.map((transaction) => transaction.calldata)).toEqual([
      `0x095ea7b3${'0'.repeat(24)}${'0'.repeat(40)}${'0'.repeat(63)}1`,
      '0x12345678',
      '0x87654321',
    ]);
    const steps = review.getByRole('region', { name: 'Prepared transactions', exact: true });
    const cards = steps.getByRole('group', { name: /^Transaction \d+$/ });
    for (let index = 0; index < await cards.count(); index += 1) {
      const dimensions = await cards.nth(index).evaluate((node) => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }));
      expect(dimensions.scrollWidth, `transaction ${index + 1} must fit without horizontal overflow`).toBeLessThanOrEqual(dimensions.clientWidth);
    }
    expect(await metric(page, 'send')).toBe(0);

    // Keep the stress route assertions above, but capture a representative
    // approval-plus-action review instead of presenting the synthetic third
    // step as a normal product state.
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.evaluate(() => {
      const harness = (window as typeof window & { __actionReviewHarness?: { multiStepExecution: boolean; rerender?: () => void } }).__actionReviewHarness;
      if (!harness) throw new Error('ActionReview fixture state is missing');
      harness.multiStepExecution = false;
      harness.rerender?.();
    });
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(review.getByText('Steps · 2', { exact: true })).toBeHidden();
    const representative = await readReviewedTransactions(review, { collapseAfterRead: false });
    expect(representative.map((transaction) => transaction.heading)).toEqual(['Approve fxUSD 1', 'Confirm 2']);
    expect(representative.map((transaction) => transaction.status)).toEqual(['Ready', 'Ready']);
    await expect(steps).toHaveCount(1);
    await steps.evaluate((node) => {
      const label = document.createElement('p');
      label.textContent = 'Synthetic test fixture · no wallet signature requested';
      label.style.cssText = 'font-size:10px;color:var(--mut);padding:0 0 8px';
      node.prepend(label);
    });
    await page.locator('[role="toolbar"]').evaluate((node) => { (node as HTMLElement).style.display = 'none'; });
    await steps.scrollIntoViewIfNeeded();
    await steps.screenshot({ path: testInfo.outputPath('action-review-steps-expanded.png') });
    expect(await metric(page, 'send')).toBe(0);
  });

  test('primary action names the required token approval and fee tier reaches wallet request fields', async ({ page }) => {
    await page.goto('/token-icons/eth.png', { waitUntil: 'load' });
    await openHarness(page);
    await page.getByRole('button', { name: 'Toggle embedded wallet mode', exact: true }).click();
    await page.getByRole('button', { name: 'Use approval route', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const approval = page.getByRole('button', { name: 'Approve fxUSD', exact: true });
    await expect(approval).toBeVisible();

    const rapid = page.locator('input[name="review-gas-tier"][value="rapid"]');
    await rapid.scrollIntoViewIfNeeded();
    await rapid.check({ force: true });
    await expect(rapid).toBeChecked();
    await approval.click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    expect(await metric(page, 'send')).toBe(2);
    const sent = await page.evaluate(() => (globalThis as typeof globalThis & { __actionReviewHarness?: { sentTransactions?: Array<{ maxFeePerGas?: string; maxPriorityFeePerGas?: string }> } }).__actionReviewHarness?.sentTransactions);
    expect(sent?.[0]).toEqual({ maxFeePerGas: '60000000000', maxPriorityFeePerGas: '20000000000' });
  });

  test('external wallets see estimated gas without fee tiers and receive no app fee caps', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Gas estimate current', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const review = page.locator('.reviewInlineContent');
    await expect(review).toContainText('0.00084 ETH');
    await expect(page.locator('input[name="review-gas-tier"]')).toHaveCount(0);
    expect((await harnessMetrics(page)).feeQuoteCount).toBe(0);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    expect((await harnessMetrics(page)).hasFeeSelection).toBe(false);
    const feeFields = await page.evaluate(() => {
      const sent = (globalThis as typeof globalThis & { __actionReviewHarness?: { sentTransactions?: Array<{ maxFeePerGas?: string; maxPriorityFeePerGas?: string }> } }).__actionReviewHarness?.sentTransactions?.[0];
      return { maxFeePerGas: sent?.maxFeePerGas, maxPriorityFeePerGas: sent?.maxPriorityFeePerGas };
    });
    expect(feeFields).toEqual({});
    expect((await harnessMetrics(page)).feeQuoteCount).toBe(0);
  });

  test('changing wallet mode invalidates an accepted embedded-fee review', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Toggle embedded wallet mode', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.locator('input[name="review-gas-tier"]')).toHaveCount(3);
    await page.getByRole('button', { name: 'Toggle embedded wallet mode', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Review updated quote', exact: true }).click();
    await expect(page.locator('input[name="review-gas-tier"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    expect((await harnessMetrics(page)).hasFeeSelection).toBe(false);
  });

  test('Confirm stays visible in the 393×852 mobile review viewport', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 393, height: 852 });
    // The harness mounts into the current document; seed a real viewport meta
    // so mobile emulation does not retain the blank page's 980px layout width.
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
    await openHarness(page, { presentationMode: true });
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
    await expect(confirm).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Confirm position changes', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Increase ETH Long', exact: true })).toBeVisible();
    await expect(page.getByText('0.25 fxUSD', { exact: true })).toBeVisible();
    await expect(page.getByText('3×', { exact: true })).toBeVisible();
    await expect(page.getByText('0.00084 ETH', { exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary navigation', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Trade', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[role="toolbar"]')).toBeHidden();
    const box = await confirm.boundingBox();
    const navBox = await page.locator('[data-fixed-navigation="true"]').boundingBox();
    const headerBox = await page.locator('.app-topbar').boundingBox();
    expect(box).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect(headerBox).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(393);
    expect(box!.y).toBeGreaterThan(headerBox!.y + headerBox!.height);
    expect(box!.y + box!.height).toBeLessThanOrEqual(navBox!.y);
    const review = page.locator('[data-review-viewport]');
    const reviewBox = await review.boundingBox();
    expect(reviewBox!.height, 'collapsed review should occupy at most half the mobile viewport').toBeLessThanOrEqual(426);
    await expect(review.locator('summary').filter({ hasText: /^Steps ·/ })).toBeHidden();
    const details = review.locator('details[aria-label="Review details"]');
    await details.locator(':scope > summary').focus();
    await page.keyboard.press('Enter');
    await expect(details).toHaveJSProperty('open', true);
    await page.keyboard.press('Enter');
    await expect(details).toHaveJSProperty('open', false);
    // Even the worst-case expanded metadata must not displace confirmation.
    await review.locator('details').evaluateAll((nodes) => nodes.forEach((node) => { (node as HTMLDetailsElement).open = true; }));
    const scrollBody = page.getByRole('region', { name: 'Review information', exact: true });
    await expect.poll(() => scrollBody.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    const expandedConfirm = await confirm.boundingBox();
    expect(expandedConfirm!.y + expandedConfirm!.height).toBeLessThanOrEqual(navBox!.y);
    await scrollBody.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await expect(confirm).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('action-review-expanded-bounded.png') });
    for (const size of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(size);
      await expect.poll(async () => {
        const action = await confirm.boundingBox();
        const bottom = await page.locator('[data-fixed-navigation="true"]').evaluate((node) => {
          const box = node.getBoundingClientRect();
          return box.height > 0 ? box.top : window.innerHeight;
        });
        return Boolean(action && action.y >= 0 && action.y + action.height <= bottom);
      }, { message: `expanded review confirmation fits ${size.width}×${size.height}` }).toBe(true);
    }
    await page.setViewportSize({ width: 393, height: 852 });
    await review.locator('details').evaluateAll((nodes) => nodes.forEach((node) => { (node as HTMLDetailsElement).open = false; }));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const duration = await details.locator(':scope > summary svg').evaluate((node) => getComputedStyle(node).transitionDuration);
    // The global reduced-motion reset uses 0.01ms to preserve end events.
    expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.00001);
    expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(852);
    await page.screenshot({ path: testInfo.outputPath('action-review-393x852.png') });
    // A narrow review on a wide viewport must remain one label/value column.
    await page.setViewportSize({ width: 1440, height: 1000 });
    const amountRow = page.getByText('Amount', { exact: true }).locator('..');
    const leverageRow = page.getByText('Target leverage', { exact: true }).locator('..');
    const amountBox = await amountRow.boundingBox();
    const leverageBox = await leverageRow.boundingBox();
    expect(leverageBox!.y).toBeGreaterThanOrEqual(amountBox!.y + amountBox!.height);
    expect(Math.abs(leverageBox!.x - amountBox!.x)).toBeLessThan(1);
    expect(await review.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('action-review-desktop.png') });
  });

  test('explicit review never signs until the separate confirmation action', async ({ page }) => {
    await openHarness(page);
    const review = page.getByRole('button', { name: 'Review position', exact: true });
    await expect(review).toBeEnabled();
    await review.click();
    const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
    await expect(confirm).toBeVisible();
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
    await confirm.click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('locks the accepted route while the wallet response is pending', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Defer wallet response', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByText('Wallet approval', { exact: true })).toBeVisible();
    const progressDetails = page.locator('summary#transaction-steps-heading').locator('..');
    await expect(progressDetails).toHaveJSProperty('open', false);

    await page.getByRole('button', { name: 'Change terms', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeVisible();
    expect(await metric(page, 'send')).toBe(1);
    expect(await metric(page, 'runner')).toBe(1);

    await page.getByRole('button', { name: 'Resolve wallet response', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    const executedRouteVersion = await page.evaluate(() => (window as typeof window & { __actionReviewHarness?: { lastExecutedRouteVersion?: number } }).__actionReviewHarness?.lastExecutedRouteVersion);
    expect(executedRouteVersion).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('keeps a deferred send visible after account change and stops later signatures', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Use multi-step route', exact: true }).click();
    await page.getByRole('button', { name: 'Defer wallet response', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByText('Wallet approval', { exact: true })).toBeVisible();
    // The wallet prompt names the exact request, including its place in the route.
    await expect(page.getByText('Confirm Open position v1 (step 1 of 2). Review it in your wallet.', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Switch account', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('selected wallet changed during this action');
    await page.getByRole('button', { name: 'Resolve wallet response', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Partially completed', exact: true })).toBeVisible();
    await expect(page.getByText('0x1111111111111111111111111111111111111111111111111111111111111111')).toBeVisible();
    expect(await metric(page, 'send')).toBe(1);
    const callbacks = await page.evaluate(() => {
      const harness = (window as typeof window & { __actionReviewHarness?: { refreshStarted?: boolean; completeStarted?: boolean } }).__actionReviewHarness;
      return { refreshStarted: harness?.refreshStarted, completeStarted: harness?.completeStarted };
    });
    expect(callbacks).toEqual({ refreshStarted: false, completeStarted: false });
  });

  test('keeps an execution latched through disconnect and reconnect while its wallet prompt is pending', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Defer wallet response', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByText('Wallet approval', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resolve wallet response', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    expect(await metric(page, 'send')).toBe(1);
    const callbacks = await page.evaluate(() => {
      const harness = (window as typeof window & { __actionReviewHarness?: { refreshStarted?: boolean; completeStarted?: boolean } }).__actionReviewHarness;
      return { refreshStarted: harness?.refreshStarted, completeStarted: harness?.completeStarted };
    });
    expect(callbacks).toEqual({ refreshStarted: false, completeStarted: false });
  });

  test('allows the requested chain switch without invalidating the executing route', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Start on Base', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('keeps the wallet-scoped draft when an invalidated wallet request is rejected', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Defer wallet response', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByText('Wallet approval', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Switch account', exact: true }).click();
    await page.getByRole('button', { name: 'Reject wallet response', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Not completed', exact: true })).toBeVisible();
    const drafts = await page.evaluate(() => {
      const harness = (window as typeof window & { __actionReviewHarness?: { draftSaveCount?: number; draftCancelCount?: number; draftRemoveCount?: number } }).__actionReviewHarness;
      return { saved: harness?.draftSaveCount, canceled: harness?.draftCancelCount, removed: harness?.draftRemoveCount };
    });
    expect(drafts).toEqual({ saved: 1, canceled: 0, removed: 0 });
    expect(await metric(page, 'send')).toBe(1);
  });

  test('keeps the draft after approval when action signing is rejected, then replans on resume', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Use approval route', exact: true }).click();
    await page.getByRole('button', { name: 'Reject action signature', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.getByRole('button', { name: 'Approve fxUSD', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Approval confirmed', exact: true })).toBeVisible();

    const beforeResume = await metric(page, 'plan');
    const retainedDraft = await page.evaluate(() => {
      const harness = (window as typeof window & { __actionReviewHarness?: { draftSaveCount?: number; draftCancelCount?: number; draftRemoveCount?: number; sendCount?: number } }).__actionReviewHarness;
      return { saved: harness?.draftSaveCount, canceled: harness?.draftCancelCount, removed: harness?.draftRemoveCount, sends: harness?.sendCount };
    });
    expect(retainedDraft).toEqual({ saved: 1, canceled: 0, removed: 0, sends: 2 });

    await page.getByRole('button', { name: 'Unmount review', exact: true }).click();
    await page.getByRole('button', { name: 'Mount review', exact: true }).click();
    await page.getByRole('button', { name: 'Resume review', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Approve fxUSD', exact: true })).toBeVisible();
    expect(await metric(page, 'plan')).toBeGreaterThan(beforeResume);
    expect(await page.getByRole('heading', { name: 'Approval confirmed', exact: true }).count()).toBe(0);
  });

  test('Continue action returns to an editable form and cancels the approval-only resume draft', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Use approval route', exact: true }).click();
    await page.getByRole('button', { name: 'Reject action signature', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.getByRole('button', { name: 'Approve fxUSD', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Approval confirmed', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Continue action', exact: true }).click();
    const drafts = await page.evaluate(() => {
      const harness = (window as typeof window & { __actionReviewHarness?: { draftSaveCount?: number; draftCancelCount?: number; draftRemoveCount?: number } }).__actionReviewHarness;
      return { saved: harness?.draftSaveCount, canceled: harness?.draftCancelCount, removed: harness?.draftRemoveCount };
    });
    expect(drafts).toEqual({ saved: 1, canceled: 1, removed: 0 });
  });

  test('does not publish a deferred wallet response after the review unmounts', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Defer wallet response', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByText('Wallet approval', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Unmount review', exact: true }).click();
    await page.getByRole('button', { name: 'Resolve wallet response', exact: true }).click();
    await page.getByRole('button', { name: 'Mount review', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Review position', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toHaveCount(0);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('does not publish a late wallet refresh after the review unmounts', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Defer wallet refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean((globalThis as typeof globalThis & { __actionReviewHarness?: { refreshStarted?: boolean } }).__actionReviewHarness?.refreshStarted))).toBe(true);
    await page.getByRole('button', { name: 'Unmount review', exact: true }).click();
    await page.getByRole('button', { name: 'Resolve wallet refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Mount review', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Review position', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toHaveCount(0);
  });

  test('keeps a fee placeholder while gas is loading and shows unavailable when estimation fails', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const review = page.locator('.reviewInlineContent');
    await expect(review.getByText('Gas fee', { exact: true })).toBeVisible();
    await expect(page.locator('.missing-value[aria-label="Loading gas fee"]')).toHaveCount(1);
    const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
    await expect(confirm).toBeEnabled();

    await page.getByRole('button', { name: 'Gas estimate unavailable', exact: true }).click();
    await expect(review).toContainText('Unavailable');
    await expect(confirm).toBeEnabled();
    expect(await metric(page, 'send')).toBe(0);
  });

  test('keeps accepted calldata when a rerender recreates the planner for the same form intent', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Recreate planner', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    const executedRouteVersion = await page.evaluate(() => (window as typeof window & { __actionReviewHarness?: { lastExecutedRouteVersion?: number } }).__actionReviewHarness?.lastExecutedRouteVersion);
    expect(executedRouteVersion).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('keeps reviewed terms visible but blocks signing when disabled or its planner disappears', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
    await expect(confirm).toBeEnabled();
    await page.getByRole('button', { name: 'Disable action', exact: true }).click();
    await expect(confirm).toBeDisabled();
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeVisible();
    expect(await metric(page, 'send')).toBe(0);
    await page.getByRole('button', { name: 'Enable action', exact: true }).click();
    await page.getByRole('button', { name: 'Remove planner', exact: true }).click();
    await expect(confirm).toBeDisabled();
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeVisible();
    expect(await metric(page, 'send')).toBe(0);
    await page.getByRole('button', { name: 'Restore planner', exact: true }).click();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    expect(await metric(page, 'send')).toBe(1);
  });

  test('invalidates the accepted route when the logical form intent really changes', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Change terms', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toHaveCount(0);
    const refresh = page.getByRole('button', { name: 'Review updated quote', exact: true });
    await expect(refresh).toBeEnabled();
    await refresh.click();
    await expect(page.getByRole('heading', { name: 'Open position v2', exact: true })).toBeVisible();
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('same-tab gas-tier preference changes invalidate the accepted review until an updated quote is explicit', async ({ page }) => {
    test.setTimeout(60_000);
    // Give this isolated harness a same-origin storage area for the real
    // settings reader before replacing the document with the harness bundle.
    // Establish the app origin without carrying the HTML document's CSP into
    // the inline harness document. The static token asset is same-origin and
    // has no document policy, while localStorage remains available.
    await page.goto('/token-icons/eth.png', { waitUntil: 'load' });
    await page.evaluate(() => window.localStorage.setItem('fxaeon.settings.v1', JSON.stringify({ slippageBps: 100, gasTier: 'fast' })));
    await openHarness(page);
    await page.getByRole('button', { name: 'Toggle embedded wallet mode', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
    await expect(confirm).toBeVisible();
    const fastTier = page.locator('input[name="review-gas-tier"][value="fast"]');
    const rapidTier = page.locator('input[name="review-gas-tier"][value="rapid"]');
    await expect(fastTier).toBeChecked();
    expect(await metric(page, 'send')).toBe(0);

    await page.evaluate(() => {
      const key = 'fxaeon.settings.v1';
      const current = JSON.parse(window.localStorage.getItem(key) || '{}') as { slippageBps?: number; [key: string]: unknown };
      window.localStorage.setItem(key, JSON.stringify({ ...current, gasTier: 'rapid' }));
      window.dispatchEvent(new CustomEvent('fxaeon:settings-updated', { detail: { slippageBps: 100, gasTier: 'rapid' } }));
    });
    await expect(confirm).toHaveCount(0);
    await expect(fastTier, 'the accepted Fast fee must remain selected until the user reviews the new tier').toBeChecked();
    const reviewUpdated = page.getByRole('button', { name: 'Review updated quote', exact: true });
    await expect(reviewUpdated).toBeEnabled();
    await expect(page.getByRole('alert')).toContainText('Network fee preference changed');
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);

    await reviewUpdated.click();
    await expect(confirm).toBeVisible();
    await expect(rapidTier).toBeChecked();
    await expect(page.locator('[aria-label="Updated transaction consequences"]')).toContainText('Fast · 30 Gwei → Rapid · 40 Gwei');
    expect(await metric(page, 'prepare')).toBe(2);
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
  });


  test('typing and connecting do not prepare quotes; Review replaces the editor once', async ({ page }) => {
    await openHarness(page, { initialPreviewMode: 'deferred' });
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await page.getByRole('button', { name: 'Change terms', exact: true }).click();
    await page.clock.install();
    await page.clock.runFor(16_000);
    expect(await metric(page, 'plan')).toBe(0);
    expect(await metric(page, 'prepare')).toBe(0);
    await expect(page.getByText('Editor terms v2', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Preparing review' })).toBeVisible();
    await expect(page.getByText('Editor terms v2', { exact: true })).toHaveCount(0);
    await expect.poll(() => metric(page, 'prepare')).toBe(1);
    const pending = (await previewRequests(page))[0]!;
    await resolvePreviewRequest(page, pending.id);
    await expect(page.getByRole('button', { name: 'Confirm' })).toBeVisible();
    expect(await metric(page, 'plan')).toBe(1);
    expect(await metric(page, 'send')).toBe(0);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByText('Editor terms v2', { exact: true })).toBeVisible();
    await page.clock.runFor(16_000);
    expect(await metric(page, 'plan')).toBe(1);
  });

  test('Edit cancels an in-flight review and ignores its late result', async ({ page }) => {
    await openHarness(page, { initialPreviewMode: 'deferred' });
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect.poll(() => metric(page, 'prepare')).toBe(1);
    const pending = (await previewRequests(page))[0]!;
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByText('Editor terms v1', { exact: true })).toBeVisible();
    await resolvePreviewRequest(page, pending.id);
    await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Review position', exact: true })).toBeEnabled();
    expect(await metric(page, 'send')).toBe(0);
  });

  test('shows the confirmed receipt while wallet refresh is pending and starts completion concurrently', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Defer wallet refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean((globalThis as typeof globalThis & { __actionReviewHarness?: { refreshStarted?: boolean } }).__actionReviewHarness?.refreshStarted))).toBe(true);
    await expect.poll(() => page.evaluate(() => Boolean((globalThis as typeof globalThis & { __actionReviewHarness?: { completeStarted?: boolean } }).__actionReviewHarness?.completeStarted))).toBe(true);
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
    await page.getByRole('button', { name: 'Resolve wallet refresh', exact: true }).click();
  });

  test('keeps partial-result copy accurate while the post-confirm refresh is pending', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Return partial result', exact: true }).click();
    await page.getByRole('button', { name: 'Defer wallet refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Partially completed', exact: true })).toBeVisible();
    await expect(page.getByText('An earlier step confirmed before the action stopped.', { exact: true })).toBeVisible();
    await expect(page.getByText('Transaction confirmed. Position details are refreshing.', { exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => Boolean((globalThis as typeof globalThis & { __actionReviewHarness?: { refreshStarted?: boolean } }).__actionReviewHarness?.refreshStarted))).toBe(true);
    await page.getByRole('button', { name: 'Resolve wallet refresh', exact: true }).click();
  });

  test('discards late planning after input and wallet changes', async ({ page }) => {
    await openHarness(page, { initialPreviewMode: 'deferred' });
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect.poll(() => metric(page, 'prepare')).toBe(1);
    const original = (await previewRequests(page))[0]!;
    await page.getByRole('button', { name: 'Change terms', exact: true }).click();
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await resolvePreviewRequest(page, original.id);
    await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Review updated quote', exact: true }).click();
    await expect.poll(() => metric(page, 'prepare')).toBe(2);
    const current = (await previewRequests(page))[1]!;
    expect(current).toMatchObject({ routeVersion: 2, connectionVersion: 2 });
    await resolvePreviewRequest(page, current.id);
    await expect(page.getByRole('heading', { name: 'Open position v2', exact: true })).toBeVisible();
    expect(await metric(page, 'send')).toBe(0);
  });

  test('uses the simulated visible route if the planner changes after the quote', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Change planner after quote', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    const executedRouteVersion = await page.evaluate(() => (globalThis as typeof globalThis & { __actionReviewHarness?: { lastExecutedRouteVersion?: number } }).__actionReviewHarness?.lastExecutedRouteVersion);
    expect(executedRouteVersion).toBe(1);
    expect(await metric(page, 'plan')).toBe(1);
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('expires a resumed review without dropping accepted terms and requires an explicit quote refresh', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await openHarness(page);
    await page.getByRole('button', { name: 'Resume review', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
    await expect(confirm).toBeVisible({ timeout: 2_000 });
    await expect(confirm).toBeEnabled();
    await expect.poll(() => metric(page, 'plan')).toBe(1);
    await expect.poll(() => metric(page, 'prepare')).toBe(1);

    await page.clock.runFor(31_000);
    // Flush a zero-delay freshness callback if React committed the review
    // effect at the end of the same fake-clock advancement.
    await page.clock.runFor(1);
    await expect(confirm).toHaveCount(0);
    const refresh = page.getByRole('button', { name: 'Review updated quote', exact: true });
    await expect(refresh).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeVisible();
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
    await page.getByRole('button', { name: 'Change quote terms to v2', exact: true }).click();
    await refresh.click();
    const changes = page.getByRole('region', { name: 'Updated transaction consequences' });
    await expect(changes).toContainText('Changed since your previous review');
    await expect(changes).toContainText('Terms 1 → Terms 2');
    await expect(confirm).toBeEnabled();
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('persists a resume hint only when the wallet request starts', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const action = page.getByRole('button', { name: 'Confirm', exact: true });
    await expect(action).toBeVisible({ timeout: 2_000 });

    await page.getByRole('button', { name: 'Fail before wallet request', exact: true }).click();
    await action.click();
    await expect(page.getByRole('alert')).toContainText('mock execution failure');
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(0);
    expect(await metric(page, 'draftSave')).toBe(0);

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await action.click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    expect(await metric(page, 'runner')).toBe(2);
    expect(await metric(page, 'send')).toBe(1);
    expect(await metric(page, 'draftSave')).toBe(1);
  });

  test('returns to the editable form after preparation fails and retries on Review', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Fail next preview', exact: true }).click();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('mock preview failure');
    await expect(page.getByText('Editor terms v2', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Open position v2', exact: true })).toBeVisible();
    expect(await metric(page, 'prepare')).toBe(2);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('keeps the reviewed route through an account change before the wallet request', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const primary = page.getByRole('button', { name: 'Confirm', exact: true });
    await expect(primary).toBeVisible({ timeout: 2_000 });
    await expect(primary).toBeEnabled({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Defer before wallet request', exact: true }).click();
    await expect(primary).toBeEnabled({ timeout: 5_000 });
    await primary.click();
    await expect.poll(() => metric(page, 'runner')).toBe(1);
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resolve execution', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Not completed', exact: true })).toBeVisible();
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(0);
  });
});
