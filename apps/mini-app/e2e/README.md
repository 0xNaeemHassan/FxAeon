# Mini App — Playwright E2E + visual regression

End-to-end and visual-regression tests for the FxAeon Telegram Mini App.

The app is a Telegram Mini App: every screen depends on `window.Telegram.WebApp`
and on the authenticated bot API (`/api/v1/miniapp/*`). Neither is real in a
test, so the suite injects a deterministic WebApp shim and intercepts every API
call with fixtures — exercising the **real page logic** (entry routing, the
build → review → gas → confirm → result flow, the honest degraded/empty states)
without a chain, a bot, or Privy.

## Layout

```
e2e/
  serve.mjs              dependency-free static server for dist/ (builds it if missing)
  playwright.config.ts   ../playwright.config.ts (fixed port 4321 → same-origin API, no CORS)
  fixtures/
    telegram.ts          deterministic window.Telegram.WebApp shim (addInitScript)
    data.ts              typed API fixtures (Me, market, quote, execute…)
    test.ts              extended `test` — injects TG + intercepts the bot API (ApiMock)
    visual.ts            snapshot stabiliser (await fonts, freeze)
  specs/                 functional specs
    splash.spec.ts       plain-browser "Open in Telegram" splash
    login.spec.ts        Privy-unconfigured + browser login gates
    portfolio.spec.ts    loaded account, fxUSD tab, empty + auth-fail states
    trade.spec.ts        build → review → Fast gas → confirm → receipt, deduped, bot-off, quote-fail
    navigation.spec.ts   bottom tab-bar routing
  visual/
    screens.spec.ts      toHaveScreenshot baselines for every key surface
  __screenshots__/       committed PNG baselines (per platform)
```

## Running

```bash
# from repo root or apps/mini-app
pnpm --filter @fxaeon/mini-app test:e2e            # functional + visual
pnpm --filter @fxaeon/mini-app test:e2e -- e2e/specs    # functional only
pnpm --filter @fxaeon/mini-app test:e2e:update     # (re)generate snapshot baselines
pnpm --filter @fxaeon/mini-app test:e2e:report     # open the last HTML report
```

`webServer` builds the static export and serves it on a **fixed** port (4321) so
the baked `NEXT_PUBLIC_BOT_API_URL` is same-origin — Playwright then fulfils the
fetches itself with no CORS/preflight to model. Build env is pinned in
`e2e/serve.mjs`:

| Var | Value | Why |
|---|---|---|
| `NEXT_PUBLIC_BOT_API_URL` | `http://localhost:4321` | same-origin; intercepted by the suite |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | `FxAeonBot` | deep links / "Open in Telegram" |
| `NEXT_PUBLIC_PRIVY_APP_ID` | `` (empty) | login renders the deterministic "not configured" gate; no heavy Privy SDK |

## How it stays deterministic

- **Telegram**: the external `telegram-web-app.js` is blocked and replaced by a
  shim (`fixtures/telegram.ts`) injected with `addInitScript` so it exists before
  any page code runs. `test.use({ telegram: false })` switches to the
  plain-browser context.
- **API**: `ApiMock` answers every `/api/v1/miniapp/**` request from fixtures.
  Shape responses per-test: `api.setMe(emptyMe)`, `api.setExecute(executeDeduped)`,
  `api.fail('POST', '/trade/execute', 403, 'BOT_TRADING_OFF', '…')`.
- **Visual**: a fixed 390×844 viewport at scale 1, `colorScheme: 'dark'`,
  `locale: 'en-US'`, `timezoneId: 'UTC'`, animations disabled, fonts awaited, and
  the live quote-TTL timer masked on the review screen.

## Updating baselines

Snapshots are committed under `e2e/__screenshots__/`. When an intentional UI
change lands, regenerate and review the diff before committing:

```bash
pnpm --filter @fxaeon/mini-app test:e2e:update
git add apps/mini-app/e2e/__screenshots__
```

> CI must generate baselines on the **same** browser build Playwright pins
> (`@playwright/test` controls the Chromium version), which is why CI installs
> `playwright install --with-deps chromium` and runs the exact pinned version.
