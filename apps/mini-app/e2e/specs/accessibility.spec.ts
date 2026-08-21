import { test, expect } from '../fixtures/test';

test.describe('Mobile accessibility contract', () => {
  test('moves focus through route, review, edit, result, and done states', async ({ page }) => {
    await page.goto('/trade');
    await expect(page.getByRole('heading', { name: 'Trade', exact: true })).toBeFocused();

    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await skip.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();

    await page.getByLabel('Input amount in ETH').fill('1');
    const trigger = page.getByRole('button', { name: 'Review wstETH long' });
    await trigger.click();
    await expect(page.getByRole('heading', { name: 'Open wstETH long' })).toBeFocused();

    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.getByRole('button', { name: /Confirm and execute/ }).click();
    await expect(page.getByRole('heading', { name: 'Confirmed on-chain' })).toBeFocused();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(trigger).toBeFocused();
  });

  test('supports roving keyboard selection and synchronizes document language', async ({ page }) => {
    await page.goto('/trade');
    const ethMarket = page.getByRole('radio', { name: /ETH market/ });
    await ethMarket.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: /BTC market/ })).toBeChecked();
    await expect(page.getByRole('radio', { name: /BTC market/ })).toBeFocused();

    await page.getByLabel('Input amount in WBTC').fill('0.01');
    await page.getByRole('button', { name: 'Review WBTC long' }).click();
    const marketSpeed = page.getByRole('radio', { name: /^market/i });
    await marketSpeed.focus();
    await page.keyboard.press('End');
    await expect(page.getByRole('radio', { name: /^fast/i })).toBeChecked();
    await expect(page.getByRole('radio', { name: /^fast/i })).toBeFocused();

    await page.goto('/settings');
    await page.getByRole('radio', { name: 'Español' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  });

  test('keeps every visible mobile control at least 44px and content clear of fixed navigation', async ({ page }) => {
    for (const path of ['/portfolio', '/trade', '/earn', '/borrow', '/positions', '/move', '/more', '/activity', '/qr', '/settings']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const undersized = await page.locator('button, a').evaluateAll((nodes) =>
        nodes.flatMap((node) => {
          const element = node as HTMLElement;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0) return [];
          // Inline prose links have the WCAG target-size exception; all app
          // controls and navigation links must meet the 44px mobile contract.
          if (style.display === 'inline') return [];
          return rect.width + 0.01 < 44 || rect.height + 0.01 < 44
            ? [{ text: element.innerText.trim().slice(0, 60), width: rect.width, height: rect.height }]
            : [];
        })
      );
      expect(undersized, `${path} undersized controls`).toEqual([]);
    }

    await page.goto('/more');
    const lastResource = page.getByRole('link', { name: /^Protocol docs/ });
    await lastResource.focus();
    const geometry = await page.evaluate(() => {
      const link = [...document.querySelectorAll('a')].find((node) => node.textContent?.includes('Protocol docs'))!;
      const nav = document.querySelector('nav[aria-label="Primary navigation"]')!;
      return { contentBottom: link.getBoundingClientRect().bottom, navTop: nav.getBoundingClientRect().top };
    });
    expect(geometry.contentBottom).toBeLessThanOrEqual(geometry.navTop);
  });
});
