/**
 * Extended Playwright test with the Mini App's two hard dependencies stubbed:
 *
 *  - Telegram: the external telegram-web-app.js is blocked and replaced with a
 *    deterministic WebApp shim (fixtures/telegram.ts). Toggle with
 *    `test.use({ telegram: false })` for the plain-browser ("Open in Telegram")
 *    paths.
 *
 *  - Bot API: every `/api/v1/miniapp/**` request is intercepted and answered
 *    from fixtures (fixtures/data.ts). Tests shape responses through the `api`
 *    fixture, e.g. `api.setMe(emptyMe)` or `api.fail('/me', 401, 'AUTH', '…')`.
 *
 * Requests are same-origin (the export is built with NEXT_PUBLIC_BOT_API_URL =
 * the test server origin), so there is no CORS/preflight to model.
 */
import { test as base, expect, type Page, type Route } from '@playwright/test';
import {
  onboardedMe,
  marketSnapshot,
  quoteFor,
  executeSuccess,
  type Me,
} from './data';
import { telegramInitScript, type TelegramShimOptions } from './telegram';
import type { MarketSnapshot, TradeExecuteResult } from '../../src/lib/api';

interface JsonResponse {
  status: number;
  body: unknown;
}

/** Programmable fixture backend for /api/v1/miniapp/*. */
export class ApiMock {
  me: Me = structuredClone(onboardedMe);
  market: MarketSnapshot = structuredClone(marketSnapshot);
  execute: TradeExecuteResult = structuredClone(executeSuccess);
  /** Per-path overrides win over the defaults above. key = `METHOD /path`. */
  private overrides = new Map<string, JsonResponse>();

  setMe(me: Me): this { this.me = structuredClone(me); return this; }
  setMarket(m: MarketSnapshot): this { this.market = structuredClone(m); return this; }
  setExecute(r: TradeExecuteResult): this { this.execute = structuredClone(r); return this; }

  /** Force a specific JSON response for one endpoint. */
  set(method: string, path: string, res: JsonResponse): this {
    this.overrides.set(`${method.toUpperCase()} ${path}`, res);
    return this;
  }
  /** Force an error envelope (matches ApiError's {error:{code,message}} shape). */
  fail(method: string, path: string, status: number, code: string, message: string): this {
    return this.set(method, path, { status, body: { error: { code, message } } });
  }

  private resolve(method: string, path: string): JsonResponse {
    const override = this.overrides.get(`${method} ${path}`);
    if (override) return override;
    if (method === 'GET' && path === '/me') return { status: 200, body: this.me };
    if (method === 'GET' && path === '/market') return { status: 200, body: this.market };
    if (method === 'POST' && path === '/market') return { status: 200, body: this.market };
    if (method === 'POST' && path === '/trade/quote') {
      const q = quoteFor(this.me.positions?.[0]?.market ?? 'wstETH');
      return { status: 200, body: { ok: true, quote: q } };
    }
    if (method === 'POST' && path === '/trade/execute') return { status: 200, body: this.execute };
    if (method === 'POST' && path === '/settings') return { status: 200, body: { ok: true } };
    if (method === 'POST' && path === '/wallet/sync')
      return { status: 200, body: { ok: true, walletDelegated: true, walletAddress: this.me.walletAddress } };
    if (method === 'POST' && path === '/onboard')
      return {
        status: 200,
        body: {
          onboarded: true,
          created: false,
          walletAddress: this.me.walletAddress,
          walletShort: '0x742d…f44e',
          referralApplied: null,
        },
      };
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: `no fixture for ${method} ${path}` } } };
  }

  async install(page: Page): Promise<void> {
    await page.route('**/api/v1/miniapp/**', async (route: Route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname.replace(/^.*\/api\/v1\/miniapp/, '') || '/';
      const { status, body } = this.resolve(req.method().toUpperCase(), path);
      await route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
      });
    });
  }
}

export const test = base.extend<{
  telegram: boolean | TelegramShimOptions;
  api: ApiMock;
}>({
  // Inject the Telegram shim by default; set `false` for browser-only screens.
  telegram: [true, { option: true }],

  // The programmable backend. Created for every test (the `page` fixture below
  // depends on it), so the setup runs whether or not a test destructures `api`.
  api: async ({}, use) => {
    await use(new ApiMock());
  },

  // Wire both hard dependencies onto EVERY page, before any navigation.
  page: async ({ page, telegram, api }, use) => {
    // Always neutralise the external Telegram script for offline determinism.
    await page.route('**/telegram-web-app.js', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* stubbed in e2e */' })
    );

    if (telegram !== false) {
      const opts = telegram === true ? {} : telegram;
      await page.addInitScript(telegramInitScript(opts), opts);
    }

    await api.install(page);
    await use(page);
  },
});

export { expect };
