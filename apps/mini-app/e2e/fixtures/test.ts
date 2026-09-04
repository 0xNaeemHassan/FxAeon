/**
 * Minimal browser fixture for the client-first Mini App.
 *
 * The app has no FxAeon HTTP API. Telegram is the only host integration we
 * shim here; RPC/Privy are deliberately left unconfigured in the test build.
 * The external USD feed is unavailable by default so screens must report an
 * honest unavailable state instead of fabricating balances or confirmations.
 */
import { test as base, expect, type Page } from "@playwright/test";
import { telegramInitScript, type TelegramShimOptions } from "./telegram";
import { browserWalletInitScript, type BrowserWalletShimOptions } from "./wallet";

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

async function installMarketPrices(page: Page, enabled: boolean): Promise<void> {
  await page.route("https://coins.llama.fi/**", async (route) => {
    if (!enabled) return route.abort("blockedbyclient");
    const encodedIds = new URL(route.request().url()).pathname.split("/prices/current/")[1] ?? "";
    const ids = decodeURIComponent(encodedIds).split(",").filter(Boolean);
    const timestamp = Math.floor(Date.now() / 1000);
    const coins = Object.fromEntries(ids.map((id) => {
      const normalised = id.toLowerCase();
      const price = normalised.includes("2260fac5e5542a773aa44fbcfedf7c193bc2c599")
        ? 104_000
        : normalised.includes("c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2")
          ? 2_400
          : normalised.includes("ae7ab96520de3a18e5e111b5eaab095312d7fe84")
            ? 2_400
          : normalised.includes("7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0")
              ? 2_850
              : normalised.includes("365accfca291e7d3914637abf1f7635db165bb09")
                ? 26
              : 1;
      return [id, { price, timestamp, confidence: 0.99 }];
    }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ coins }) });
  });

  await page.route("https://api.coingecko.com/**", async (route) => {
    if (!enabled) return route.abort("blockedbyclient");
    const url = new URL(route.request().url());
    const marketId = url.pathname.match(/\/coins\/([^/]+)\/market_chart$/)?.[1];
    if (marketId !== "ethereum" && marketId !== "bitcoin") return route.abort("blockedbyclient");
    const days = Math.max(1, Math.min(30, Number(url.searchParams.get("days")) || 1));
    const count = 120;
    const end = Date.now();
    const start = end - days * 24 * 60 * 60 * 1_000;
    const basePrice = marketId === "bitcoin" ? 104_000 : 2_400;
    const prices = Array.from({ length: count }, (_, index) => {
      const progress = index / (count - 1);
      const timestamp = Math.round(start + progress * (end - start));
      const trend = 0.975 + progress * 0.025;
      const wave = Math.sin(index / 7) * 0.003;
      return [timestamp, Number((basePrice * (trend + wave)).toFixed(6))];
    });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ prices }) });
  });
}

export const test = base.extend<{
  telegram: boolean | TelegramShimOptions;
  browserWallet: false | BrowserWalletShimOptions;
  marketPrices: boolean;
  requests: ObservedRequests;
}>({
  telegram: [true, { option: true }],
  browserWallet: [false, { option: true }],
  marketPrices: [false, { option: true }],
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
        const publicDataHosts = new Set(["assets.smold.app", "api.coingecko.com"]);
        if (/\/api(?:\/|$)/i.test(pathname) && !publicDataHosts.has(host)) observed.backend.push(url);
      } catch {
        // Ignore malformed URLs; Playwright normally supplies absolute URLs.
      }
    });
    await use(observed);
  },
  page: async ({ page, telegram, browserWallet, marketPrices }, use) => {
    await installTelegram(page, telegram);
    await installMarketPrices(page, marketPrices);
    if (browserWallet !== false) await page.addInitScript(browserWalletInitScript(browserWallet), browserWallet);
    await use(page);
  },
});

export { expect };

export function assertNoBackendRequests(requests: ObservedRequests): void {
  expect(requests.backend, "client-first app must not call an FxAeon backend").toEqual([]);
}
