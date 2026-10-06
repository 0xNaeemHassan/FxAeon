import assert from 'node:assert/strict';
import { expect, type Locator } from '@playwright/test';

export type ReviewedTransaction = {
  heading: string;
  status: string;
  contract: string;
  calldata: string;
  valueWei: string;
};

/** Read and validate the one canonical Steps disclosure shown before signing. */
export async function readReviewedTransactions(
  actionDetails: Locator,
  options: { collapseAfterRead?: boolean } = {},
): Promise<ReviewedTransaction[]> {
  await expect(actionDetails).toBeVisible({ timeout: 180_000 });
  const reviewDetails = actionDetails.locator('details[aria-label="Review details"]');
  if (await reviewDetails.count() && !await reviewDetails.evaluate((element) => (element as HTMLDetailsElement).open)) {
    await reviewDetails.locator(':scope > summary').click();
  }
  const stepsSummary = actionDetails.locator('summary').filter({ hasText: /^Steps · \d+$/ });
  const stepsDisclosure = stepsSummary.locator('..');
  await expect(stepsDisclosure).toHaveCount(1);
  await expect(stepsDisclosure).toBeVisible();
  const isOpen = await stepsDisclosure.evaluate((element) => (element as HTMLDetailsElement).open);
  if (!isOpen) await stepsSummary.click();

  const steps = actionDetails.getByRole('region', { name: 'Prepared transactions', exact: true });
  await expect(steps).toHaveCount(1);
  const cards = steps.getByRole('group', { name: /^Transaction \d+$/ });
  const cardCount = await cards.count();
  const reviewed: ReviewedTransaction[] = [];
  for (let index = 0; index < cardCount; index += 1) {
    const card = cards.nth(index);
    await expect(card).toHaveAttribute('aria-label', `Transaction ${index + 1}`);
    const transactionSummary = card.locator('summary').filter({ hasText: /^Transaction details$/ });
    const transactionDetails = transactionSummary.locator('..');
    await expect(transactionDetails).toHaveCount(1);
    const detailsOpen = await transactionDetails.evaluate((element) => (element as HTMLDetailsElement).open);
    if (!detailsOpen) await transactionSummary.click();

    const transaction = await card.evaluate((element) => {
      const rows: Record<string, string> = {};
      for (const row of Array.from(element.querySelectorAll('div.flex.items-start'))) {
        const children = Array.from(row.children);
        const label = children[0]?.textContent?.trim();
        const value = children[1]?.textContent?.trim();
        if (label && value) rows[label] = value;
      }
      const displayedHeading = element.querySelector('span')?.textContent?.trim() ?? '';
      const status = element.querySelectorAll('span')[1]?.textContent?.trim() ?? '';
      const headingMatch = displayedHeading.match(/^(\d+)\.\s+(.+)$/);
      return {
        // Keep the fork extractor's established `${title} ${index}` format.
        heading: headingMatch ? `${headingMatch[2]} ${headingMatch[1]}` : displayedHeading,
        status,
        contract: rows.Contract ?? '',
        calldata: '',
        valueWei: rows['Transaction value (wei)'] ?? '',
      };
    });
    const calldata = card.locator('pre[aria-label="Transaction calldata"]');
    await expect(calldata).toHaveCount(1);
    transaction.calldata = (await calldata.textContent() ?? '').trim();
    reviewed.push(transaction);
  }

  assert.ok(reviewed.length > 0 && reviewed.length <= 10, 'action details must list one to ten transactions');
  assert.ok(reviewed.some((transaction) => /^Confirm\s+\d+$/.test(transaction.heading)), 'action details must include the protocol action');
  reviewed.forEach((transaction, index) => {
    const headingNumber = transaction.heading.match(/^(?:Confirm|Approve\b).*\s(\d+)$/)?.[1];
    assert.equal(headingNumber, String(index + 1), `transaction ${index + 1} must have an ordered heading`);
    assert.match(transaction.contract, /^0x[0-9a-fA-F]{40}$/, `transaction ${index + 1} must show its contract`);
    assert.match(transaction.calldata, /^0x[0-9a-fA-F]*$/, `transaction ${index + 1} must show its calldata`);
    assert.match(transaction.valueWei, /^\d+$/, `transaction ${index + 1} must show its exact native value in wei`);
  });
  await expect(steps.locator('pre[aria-label="Transaction calldata"]')).toHaveCount(reviewed.length);

  if (options.collapseAfterRead !== false) {
    await stepsSummary.click();
    if (await reviewDetails.count()) await reviewDetails.locator(':scope > summary').click();
  }
  return reviewed;
}
