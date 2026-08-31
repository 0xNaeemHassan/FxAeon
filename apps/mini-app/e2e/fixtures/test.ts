/**
 * Minimal browser fixture for the client-first Mini App.
 *
 * The app has no FxAeon HTTP API. Telegram is the only host integration we
 * shim here; RPC/Privy are deliberately left unconfigured in the test build
 * so the UI has to report an honest unavailable state instead of fabricating
 * balances, prices, or confirmations.
 */
import { test as base, expect, type Page } from "@playwright/test";
import { telegramInitScript, type TelegramShimOptions } from "./telegram";

export interface ObservedRequests {
  all: string[];
  backend: string[];
}

async function installTelegram(page: Page, telegram: boolean | TelegramShimOptions): Promise<void> {
  await page.route("**/telegram-web-app.js", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: "/* deterministic test shim */",
    }),
  );
  if (telegram !== false) {
    const options = telegram === true ? {} : telegram;
    await page.addInitScript(telegramInitScript(options), options);
  }
}

export const test = base.extend<{
  telegram: boolean | TelegramShimOptions;
  requests: ObservedRequests;
}>({
  telegram: [true, { option: true }],
  requests: async ({ page }, use) => {
    const observed: ObservedRequests = { all: [], backend: [] };
    page.on("request", (request) => {
      const url = request.url();
      observed.all.push(url);
      try {
        const pathname = new URL(url).pathname;
        // The maintained token-assets CDN exposes image files under `/api`.
        // That is an asset host, not an FxAeon application backend; keep the
        // client-first assertion focused on same-origin/unknown API routes.
        const host = new URL(url).hostname;
        if (/\/api(?:\/|$)/i.test(pathname) && host !== "assets.smold.app") observed.backend.push(url);
      } catch {
        // Ignore malformed URLs; Playwright normally supplies absolute URLs.
      }
    });
    await use(observed);
  },
  page: async ({ page, telegram }, use) => {
    await installTelegram(page, telegram);
    await use(page);
  },
});

export { expect };

export function assertNoBackendRequests(requests: ObservedRequests): void {
  expect(requests.backend, "client-first app must not call an FxAeon backend").toEqual([]);
}
