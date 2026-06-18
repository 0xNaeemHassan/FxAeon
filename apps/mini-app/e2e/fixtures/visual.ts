/**
 * Visual-regression stabilisers. Playwright's `animations: 'disabled'` already
 * freezes CSS animations/transitions at their end state; on top of that we wait
 * for web fonts to finish loading (the app self-hosts Inter / Space Grotesk via
 * next/font, so this is same-origin and fast) so glyph metrics never shift the
 * baseline between the first and subsequent runs.
 */
import type { Page } from '@playwright/test';

/** Wait until the page is painted and fonts are ready for a stable screenshot. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    // @ts-expect-error fonts is on Document in browsers
    if (document.fonts?.ready) await document.fonts.ready;
  });
  // One rAF so any layout from the font swap is committed.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
}
