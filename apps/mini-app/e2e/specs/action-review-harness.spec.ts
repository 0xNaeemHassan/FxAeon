import { test, expect } from '@playwright/test';
import { openHarness, metric } from '../harness/action-review-measurement-support';
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
  test('explicit review never signs until the separate confirmation action', async ({ page }) => {
    await openHarness(page);
    const review = page.getByRole('button', { name: 'Review position', exact: true });
    await expect(review).toBeEnabled();
    await review.click();
    const confirm = page.getByRole('button', { name: 'Confirm in wallet', exact: true });
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
    await expect(page.getByRole('button', { name: 'Confirm in wallet', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Defer wallet response', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm in wallet', exact: true }).click();
    await expect(page.getByText('Wallet approval', { exact: true })).toBeVisible();

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

  test('keeps accepted calldata when a rerender recreates the planner for the same form intent', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Recreate planner', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm in wallet', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Confirm in wallet', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    const executedRouteVersion = await page.evaluate(() => (window as typeof window & { __actionReviewHarness?: { lastExecutedRouteVersion?: number } }).__actionReviewHarness?.lastExecutedRouteVersion);
    expect(executedRouteVersion).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('keeps reviewed terms visible but blocks signing when disabled or its planner disappears', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'Confirm in wallet', exact: true });
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
    await expect(page.getByRole('button', { name: 'Confirm in wallet', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Open position v1', exact: true })).toHaveCount(0);
    const refresh = page.getByRole('button', { name: 'Review updated quote', exact: true });
    await expect(refresh).toBeEnabled();
    await refresh.click();
    await expect(page.getByRole('heading', { name: 'Open position v2', exact: true })).toBeVisible();
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
    await expect(page.getByRole('button', { name: 'Confirm in wallet' })).toBeVisible();
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
    await expect(page.getByRole('button', { name: 'Confirm in wallet' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Review position', exact: true })).toBeEnabled();
    expect(await metric(page, 'send')).toBe(0);
  });

  test('shows the confirmed receipt while wallet refresh is pending and starts completion concurrently', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm in wallet', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Defer wallet refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm in wallet', exact: true }).click();
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
    await expect(page.getByRole('button', { name: 'Confirm in wallet', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Return partial result', exact: true }).click();
    await page.getByRole('button', { name: 'Defer wallet refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm in wallet', exact: true }).click();
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
    await expect(page.getByRole('button', { name: 'Confirm in wallet' })).toHaveCount(0);
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
    await expect(page.getByRole('button', { name: 'Confirm in wallet', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm in wallet', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Change planner after quote', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm in wallet', exact: true }).click();
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
    const confirm = page.getByRole('button', { name: 'Confirm in wallet', exact: true });
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
    const action = page.getByRole('button', { name: 'Confirm in wallet', exact: true });
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

  test('drops a deferred execution after the account changes before the wallet request', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const primary = page.getByRole('button', { name: 'Confirm in wallet', exact: true });
    await expect(primary).toBeVisible({ timeout: 2_000 });
    await expect(primary).toBeEnabled({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Defer before wallet request', exact: true }).click();
    await expect(primary).toBeEnabled({ timeout: 5_000 });
    await primary.click();
    await expect.poll(() => metric(page, 'runner')).toBe(1);
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resolve execution', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(0);
  });
});
