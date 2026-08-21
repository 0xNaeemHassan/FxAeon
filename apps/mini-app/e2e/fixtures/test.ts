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
  actionExecuteSuccess,
  actionQuoteFor,
  activityItems,
  bridgeState,
  onboardedMe,
  marketSnapshot,
  protocolInfo,
  type Me,
} from './data';
import { telegramInitScript, type TelegramShimOptions } from './telegram';
import type {
  ActionExecuteResult,
  ActivityItem,
  BridgeState,
  MarketSnapshot,
  MiniActionParams,
  ProtocolInfo,
} from '../../src/lib/api';

interface JsonResponse {
  status: number;
  body: unknown;
}

export interface ApiRequest {
  method: string;
  path: string;
  body: unknown;
}

/** Programmable fixture backend for /api/v1/miniapp/*. */
export class ApiMock {
  me: Me = structuredClone(onboardedMe);
  market: MarketSnapshot = structuredClone(marketSnapshot);
  protocol: ProtocolInfo = structuredClone(protocolInfo);
  bridge: BridgeState = structuredClone(bridgeState);
  activity: ActivityItem[] = structuredClone(activityItems);
  execute: ActionExecuteResult = structuredClone(actionExecuteSuccess);
  readonly requests: ApiRequest[] = [];
  /** Per-path overrides win over the defaults above. key = `METHOD /path`. */
  private overrides = new Map<string, JsonResponse>();

  setMe(me: Me): this { this.me = structuredClone(me); return this; }
  setMarket(m: MarketSnapshot): this { this.market = structuredClone(m); return this; }
  setProtocol(info: ProtocolInfo): this { this.protocol = structuredClone(info); return this; }
  setBridgeState(state: BridgeState): this { this.bridge = structuredClone(state); return this; }
  setActivity(items: ActivityItem[]): this { this.activity = structuredClone(items); return this; }
  setExecute(r: ActionExecuteResult): this { this.execute = structuredClone(r); return this; }

  lastRequest(method: string, path: string): ApiRequest | undefined {
    return this.requests.findLast((request) => request.method === method.toUpperCase() && request.path === path);
  }

  /** Force a specific JSON response for one endpoint. */
  set(method: string, path: string, res: JsonResponse): this {
    this.overrides.set(`${method.toUpperCase()} ${path}`, res);
    return this;
  }
  /** Force an error envelope (matches ApiError's {error:{code,message}} shape). */
  fail(method: string, path: string, status: number, code: string, message: string): this {
    return this.set(method, path, { status, body: { error: { code, message } } });
  }

  private resolve(method: string, path: string, body: unknown): JsonResponse {
    const override = this.overrides.get(`${method} ${path}`);
    if (override) return override;
    if (method === 'GET' && path === '/me') return { status: 200, body: this.me };
    if (method === 'GET' && path === '/market') return { status: 200, body: this.market };
    if (method === 'POST' && path === '/market') return { status: 200, body: this.market };
    if (method === 'GET' && path === '/protocol') return { status: 200, body: this.protocol };
    if (method === 'GET' && path === '/bridge-state') return { status: 200, body: this.bridge };
    if (method === 'GET' && path === '/activity') return { status: 200, body: { items: this.activity } };
    if (method === 'POST' && path === '/action/quote') {
      return { status: 200, body: { ok: true, quote: actionQuoteFor(body as MiniActionParams) } };
    }
    if (method === 'POST' && path === '/action/execute') {
      const params = body as { ticket?: unknown };
      const chainId = typeof params.ticket === 'string' && params.ticket.startsWith('B') ? 8453 : 1;
      return { status: 200, body: { ...this.execute, chainId } };
    }
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
      const method = req.method().toUpperCase();
      let requestBody: unknown = undefined;
      if (req.postData()) {
        try { requestBody = req.postDataJSON(); }
        catch { requestBody = req.postData(); }
      }
      this.requests.push({ method, path, body: structuredClone(requestBody) });
      const { status, body } = this.resolve(method, path, requestBody);
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
