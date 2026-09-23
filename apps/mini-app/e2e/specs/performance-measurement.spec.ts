import { test, expect } from '../fixtures/test';
import { openHarness } from '../harness/action-review-measurement-support';
import { measureSince, measureUntil, reportPerformanceEvidence } from '../performance-evidence';

test('records time from Trade navigation to an editable amount field', async ({ page, browser }, testInfo) => {
  const input = page.getByRole('textbox', { name: 'Amount in ETH' });
  const sample = await measureUntil(page, 'editable-form', 'browser-route', 'Trade route navigation until the amount field is visible and enabled.', async () => {
    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();
  });
  await reportPerformanceEvidence(browser, testInfo, [sample]);
});

test('records usable quote and refreshed account timings in the deterministic ActionReview harness', async ({ page, browser }, testInfo) => {
  // These controlled waits stand in for quote preparation and wallet refresh.
  // They exercise ActionReview and visible states, but they are not live RPC or chain timings.
  const harnessStartedAt = await openHarness(page, { previewDelayMs: 125, refreshDelayMs: 225 });
  const quoteSample = await measureSince(
    page,
    'usable-quote',
    'deterministic-simulation',
    'ActionReview mount until its prepared route is reviewable; harness inserts 125 ms before route preparation resolves.',
    harnessStartedAt,
    async () => {
      await expect(page.locator('section[aria-label="Review details"]')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Open position v1', exact: true })).toBeEnabled();
    },
  );

  await page.getByRole('button', { name: 'Use explicit review', exact: true }).click();
  await page.getByRole('button', { name: 'Review position', exact: true }).click();
  const confirm = page.getByRole('button', { name: 'Confirm in wallet', exact: true });
  await expect(confirm).toBeVisible();
  const refreshSample = await measureUntil(
    page,
    'refreshed-account',
    'deterministic-simulation',
    'One explicit harness confirmation until the refreshed account fixture is visible; harness inserts 225 ms before invalidation resolves.',
    async () => {
      await confirm.click();
      await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
      await expect(page.getByLabel('Refreshed account value')).toHaveText('1.25 ETH');
    },
  );
  await reportPerformanceEvidence(browser, testInfo, [quoteSample, refreshSample]);
});
