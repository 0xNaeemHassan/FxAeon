import { test, expect } from '../fixtures/test';

test.use({ telegram: false });

test('baseline forms keep their action above navigation and Move stays centered', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  for (const route of ['/trade', '/borrow', '/earn', '/move']) {
    await page.goto(route);
    const action = page.locator('.reviewTrigger .button-primary');
    await expect(action).toBeVisible();
    const bounds = await action.evaluate(element => {
      const main = document.querySelector('main')!;
      const nav = document.querySelector('nav.mobile-tabbar')!;
      const rect = element.getBoundingClientRect();
      return { bottom: rect.bottom, height: rect.height, navTop: nav.getBoundingClientRect().top, scroll: main.scrollTop };
    });
    expect(bounds.scroll, `${route} starts at the top`).toBe(0);
    expect(bounds.height, `${route} primary CTA retains its 48px baseline`).toBeGreaterThanOrEqual(48);
    expect(bounds.bottom, `${route} action clears navigation`).toBeLessThanOrEqual(bounds.navTop - 4);
    if (route === '/borrow') await expect(page.getByRole('heading', { name: 'Borrow fxUSD', exact: true })).toHaveCount(0);
    if (route === '/move') {
      const gaps = await page.locator('[data-flow-stage]').evaluate(card => {
        const rect = card.getBoundingClientRect();
        const stage = card.parentElement!.getBoundingClientRect();
        return { top: rect.top - stage.top, bottom: stage.bottom - rect.bottom };
      });
      expect(Math.abs(gaps.top - gaps.bottom)).toBeLessThanOrEqual(2);
    }
  }
});

test('amount shortcuts retain touch targets and never overlap the label', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/earn');
  await page.getByRole('radio', { name: 'Withdraw', exact: true }).click();
  const field = page.locator('[data-amount-field]');
  const geometry = await field.evaluate(element => {
    const label = element.querySelector('label')!.getBoundingClientRect();
    const shortcuts = element.querySelector('[role="group"]')!.getBoundingClientRect();
    return { labelRight: label.right, shortcutsLeft: shortcuts.left,
      buttons: [...element.querySelectorAll('[role="group"] button')].map(button => ({ w: button.getBoundingClientRect().width, h: button.getBoundingClientRect().height })) };
  });
  expect(geometry.labelRight).toBeLessThanOrEqual(geometry.shortcutsLeft);
  expect(geometry.buttons).toHaveLength(4);
  for (const button of geometry.buttons) { expect(button.w).toBeGreaterThanOrEqual(44); expect(button.h).toBeGreaterThanOrEqual(44); }
});
