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

async function expectNoEnabledCurrentAction(page: import('@playwright/test').Page): Promise<void> {
  const currentAction = page.getByRole('button', { name: 'Open position v2', exact: true });
  await expect(currentAction.and(page.locator('button:not(:disabled)'))).toHaveCount(0);
  expect(await metric(page, 'runner')).toBe(0);
  expect(await metric(page, 'send')).toBe(0);
}

test.describe('ActionReview isolated orchestration', () => {
  test('explicit review never signs until the separate confirmation action', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Use explicit review', exact: true }).click();
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
    await page.getByRole('button', { name: 'Use explicit review', exact: true }).click();
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
    await page.getByRole('button', { name: 'Use explicit review', exact: true }).click();
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
    await page.getByRole('button', { name: 'Use explicit review', exact: true }).click();
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
    await page.getByRole('button', { name: 'Use explicit review', exact: true }).click();
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


  test('connect and preview never sign, then one direct primary click runs once', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open position v1', exact: true })).toBeVisible({ timeout: 2_000 });
    const actionDetails = page.locator('section[aria-label="Review details"]');
    await expect(actionDetails).toBeVisible();
    const quoteDetails = actionDetails.locator('details').filter({ hasText: /^Quote details/ }).first();
    await expect(quoteDetails).toHaveCount(1);
    await quoteDetails.locator('summary').click();
    await expect(quoteDetails.getByText('Route', { exact: true })).toBeVisible();
    await expect(quoteDetails.getByText('Terms 1', { exact: true })).toBeVisible();
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
    await page.getByRole('button', { name: 'Open position v1', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('shows the confirmed receipt while wallet refresh is pending and starts completion concurrently', async ({ page }) => {
    await openHarness(page);
    await expect(page.getByRole('button', { name: 'Open position v1', exact: true })).toBeVisible({ timeout: 2_000 });
    await page.getByRole('button', { name: 'Defer wallet refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Open position v1', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean((globalThis as typeof globalThis & { __actionReviewHarness?: { refreshStarted?: boolean } }).__actionReviewHarness?.refreshStarted))).toBe(true);
    await expect.poll(() => page.evaluate(() => Boolean((globalThis as typeof globalThis & { __actionReviewHarness?: { completeStarted?: boolean } }).__actionReviewHarness?.completeStarted))).toBe(true);
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
    await page.getByRole('button', { name: 'Resolve wallet refresh', exact: true }).click();
  });

  test('keeps partial-result copy accurate while the post-confirm refresh is pending', async ({ page }) => {
    await openHarness(page);
    await expect(page.getByRole('button', { name: 'Open position v1', exact: true })).toBeVisible({ timeout: 2_000 });
    await page.getByRole('button', { name: 'Return partial result', exact: true }).click();
    await page.getByRole('button', { name: 'Defer wallet refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Open position v1', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Partially completed', exact: true })).toBeVisible();
    await expect(page.getByText('An earlier step confirmed before the action stopped.', { exact: true })).toBeVisible();
    await expect(page.getByText('Transaction confirmed. Position details are refreshing.', { exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => Boolean((globalThis as typeof globalThis & { __actionReviewHarness?: { refreshStarted?: boolean } }).__actionReviewHarness?.refreshStarted))).toBe(true);
    await page.getByRole('button', { name: 'Resolve wallet refresh', exact: true }).click();
  });

  test('ignores stale preview completion after terms and account changes', async ({ page }) => {
    const account = '0x00000000000000000000000000000000000000aa';
    await openHarness(page, { initialPreviewMode: 'deferred' });
    await expect.poll(() => metric(page, 'prepare')).toBe(1);

    await expect.poll(async () => (await previewRequests(page)).some((request) => (
      request.routeVersion === 1
      && request.routeType === 'Terms 1'
      && request.routeWalletAddress === account
      && request.previewWalletAddress === account
      && request.connectionVersion === 1
      && !request.settled
    ))).toBe(true);
    const original = (await previewRequests(page)).find((request) => request.routeVersion === 1 && request.connectionVersion === 1);
    expect(original).toMatchObject({
      routeVersion: 1,
      routeType: 'Terms 1',
      routeWalletAddress: account,
      previewWalletAddress: account,
      connectionVersion: 1,
      settled: false,
    });

    await page.getByRole('button', { name: 'Change terms', exact: true }).click();
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await resolvePreviewRequest(page, original!.id);
    await expect(page.getByRole('button', { name: 'Open position v1', exact: true })).toHaveCount(0);
    await expectNoEnabledCurrentAction(page);

    await expect.poll(async () => (await previewRequests(page)).some((request) => (
      request.routeVersion === 2
      && request.routeType === 'Terms 2'
      && request.routeWalletAddress === account
      && request.previewWalletAddress === account
      && request.connectionVersion === 2
      && !request.settled
    ))).toBe(true);
    const requests = await previewRequests(page);
    const activeRequests = requests.filter((request) => (
      request.routeVersion === 2
      && request.routeType === 'Terms 2'
      && request.routeWalletAddress === account
      && request.previewWalletAddress === account
      && request.connectionVersion === 2
      && !request.settled
    ));
    expect(activeRequests).toHaveLength(1);
    const active = activeRequests[0]!;
    expect(await metric(page, 'prepare')).toBe(requests.length);
    expect(active.id).toBe(requests.length);

    // Terms can schedule an intermediate preview before the wallet change is
    // committed. Resolve any such request by its captured identity, never FIFO.
    const intermediate = requests.filter((request) => (
      request.id !== original!.id
      && request.id !== active.id
      && !request.settled
    ));
    for (const request of intermediate) {
      await resolvePreviewRequest(page, request.id);
      await expect(page.getByRole('button', { name: 'Open position v1', exact: true })).toHaveCount(0);
      await expectNoEnabledCurrentAction(page);
    }

    expect(active).toMatchObject({
      routeVersion: 2,
      routeType: 'Terms 2',
      routeWalletAddress: account,
      previewWalletAddress: account,
      connectionVersion: 2,
      settled: false,
    });
    await resolvePreviewRequest(page, active.id);
    const currentAction = page.getByRole('button', { name: 'Open position v2', exact: true });
    await expect(currentAction).toBeVisible();
    await expect(currentAction).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Open position v1', exact: true })).toHaveCount(0);
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('uses the simulated visible route if the planner changes after the quote', async ({ page }) => {
    await openHarness(page);
    await expect(page.getByRole('button', { name: 'Open position v1', exact: true })).toBeVisible({ timeout: 2_000 });
    await expect(page.getByRole('button', { name: 'Open position v1', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Change planner after quote', exact: true }).click();
    await page.getByRole('button', { name: 'Open position v1', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    const executedRouteVersion = await page.evaluate(() => (globalThis as typeof globalThis & { __actionReviewHarness?: { lastExecutedRouteVersion?: number } }).__actionReviewHarness?.lastExecutedRouteVersion);
    expect(executedRouteVersion).toBe(1);
    expect(await metric(page, 'plan')).toBe(1);
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
  });

  test('blocks a preview whose refresh is still pending after its 30-second freshness window', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await openHarness(page);
    // Let the debounced first quote finish under the fake clock before
    // switching the harness to defer the subsequent background refresh.
    await page.clock.runFor(500);
    const action = page.getByRole('button', { name: 'Open position v1', exact: true });
    await expect(action).toBeVisible({ timeout: 2_000 });
    await expect(action).toBeEnabled();
    await expect.poll(() => metric(page, 'plan')).toBe(1);
    await expect.poll(() => metric(page, 'prepare')).toBe(1);
    await page.getByRole('button', { name: 'Defer preview', exact: true }).click();

    // Initial preview starts after a short debounce, so advance past the full
    // refresh interval measured from that first route's preparation time.
    await page.clock.runFor(16_000);
    await expect.poll(() => metric(page, 'prepare')).toBe(2);
    await expect.poll(async () => (await previewRequests(page)).some((request) => (
      request.routeVersion === 1
      && request.routeType === 'Terms 1'
      && request.routeWalletAddress === '0x00000000000000000000000000000000000000aa'
      && request.previewWalletAddress === '0x00000000000000000000000000000000000000aa'
      && request.connectionVersion === 1
      && !request.settled
    ))).toBe(true);
    const refresh = (await previewRequests(page)).find((request) => (
      request.routeVersion === 1
      && request.routeType === 'Terms 1'
      && request.connectionVersion === 1
      && !request.settled
    ));
    expect(refresh?.settled).toBe(false);
    await page.clock.runFor(15_000);

    await expect(action).toBeDisabled();
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
    await resolvePreviewRequest(page, refresh!.id);
    await expect(action).toBeEnabled();
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('expires a resumed review without dropping accepted terms and requires an explicit quote refresh', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await openHarness(page);
    await page.getByRole('button', { name: 'Resume legacy review', exact: true }).click();
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
    const action = page.getByRole('button', { name: 'Open position v1', exact: true });
    await expect(action).toBeVisible({ timeout: 2_000 });

    await page.getByRole('button', { name: 'Fail before wallet request', exact: true }).click();
    await action.click();
    await expect(page.getByRole('alert')).toContainText('mock execution failure');
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(0);
    expect(await metric(page, 'draftSave')).toBe(0);

    await action.click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    expect(await metric(page, 'runner')).toBe(2);
    expect(await metric(page, 'send')).toBe(1);
    expect(await metric(page, 'draftSave')).toBe(1);
  });

  test('exposes Try again after preview failure and recovers without signing', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Fail next preview', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible({ timeout: 2_000 });
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open position v2', exact: true })).toBeVisible({ timeout: 2_000 });
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
  });

  test('drops a deferred execution after the account changes before the wallet request', async ({ page }) => {
    await openHarness(page);
    const primary = page.getByRole('button', { name: 'Open position v1', exact: true });
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
