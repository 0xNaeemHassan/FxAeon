import { expect, test, assertNoBackendRequests } from '../fixtures/test';

test.use({ telegram: false });

for (const width of [320, 390, 1280]) {
  test(`leverage examples fit ${width}px and leave the trade ticket unchanged`, async ({ page, requests }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/trade', { waitUntil: 'domcontentloaded' });
    const ticketSide = page.getByRole('radiogroup', { name: 'Position side' });
    const amount = page.getByRole('textbox', { name: 'Amount in ETH' });
    await amount.fill('0.125');
    const explanation = page.getByRole('region', { name: 'Leverage in three steps' });
    const example = explanation.getByRole('radiogroup', { name: 'Leverage example' });
    await example.scrollIntoViewIfNeeded();
    await expect(example.getByRole('radio', { name: 'Long example' })).toBeChecked();
    await expect(explanation.getByText('Example', { exact: true })).toBeVisible();
    await expect(explanation).toContainText('67% minted fxUSD · 33% yours');
    const split = explanation.getByRole('list', { name: /Share of a position/ });
    const longHeight = (await split.boundingBox())!.height;
    await explanation.screenshot({ path: testInfo.outputPath('long-example.png') });

    await example.getByRole('radio', { name: 'Short example' }).click();
    await expect(example.getByRole('radio', { name: 'Short example' })).toBeChecked();
    await expect(explanation).toContainText('75% borrowed wstETH · 25% yours');
    await expect(explanation).not.toContainText('pool maximum');
    expect((await split.boundingBox())!.height, 'comparing directions must not move the content below').toBe(longHeight);
    await expect(ticketSide.getByRole('radio', { name: 'Long' })).toBeChecked();
    await expect(amount).toHaveValue('0.125');
    await explanation.screenshot({ path: testInfo.outputPath('short-example.png') });

    for (const radio of await example.getByRole('radio').all()) {
      const box = await radio.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    const bounds = await explanation.evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    assertNoBackendRequests(requests);
  });
}
