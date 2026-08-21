# Mini App Playwright E2E and visual regression

These tests exercise FxAeon's real Telegram Mini App pages against deterministic
Telegram and bot-API fixtures. No wallet, bot, Privy service, or chain is needed.

The suite covers the complete mobile gateway contract:

- the Home, Trade, Earn, Move, and More information architecture;
- wallet-scoped `/action/quote` and `/action/execute` intents;
- leveraged positions, fxUSD borrowing, the fxSAVE lifecycle, and position management;
- Ethereum to Base and Base to Ethereum bridging;
- chain-aware Etherscan and BaseScan links;
- authenticated portfolio states, launch gates, and failure handling;
- 390px mobile overflow and pixel-level visual baselines.

## Layout

```text
e2e/
  serve.mjs              builds and serves the static export on port 4321
  fixtures/
    telegram.ts          deterministic window.Telegram.WebApp shim
    data.ts              typed account, protocol, action, and activity data
    test.ts              programmable API mock plus exact request journal
    visual.ts            font and animation stabilizer
  specs/
    splash.spec.ts       plain-browser Telegram gate
    login.spec.ts        Privy and browser login gates
    portfolio.spec.ts    loaded, savings, empty, and auth-failure states
    trade.spec.ts        intent, review, gas, execution, idempotency, failures
    gateway.spec.ts      Earn, Borrow, Positions, Move, Activity, mobile fit
    navigation.spec.ts   primary tabs and every secondary route
  visual/screens.spec.ts primary-screen screenshot contracts
  __screenshots__/       reviewed baseline PNGs
```

## Run

```bash
pnpm --filter @fxaeon/mini-app test:e2e
pnpm --filter @fxaeon/mini-app test:e2e -- e2e/specs
pnpm --filter @fxaeon/mini-app test:e2e:update
pnpm --filter @fxaeon/mini-app test:e2e:report
```

The server rebuilds the app with a same-origin API URL. Playwright intercepts
every `/api/v1/miniapp/**` request. The `ApiMock` records submitted bodies, so a
test can assert the exact protocol intent with
`api.lastRequest('POST', '/action/quote')` in addition to checking rendered UI.

Use `api.setMe(...)`, `api.setExecute(...)`, `api.setActivity(...)`, and
`api.fail(...)` to shape a scenario. The Telegram shim records `openLink`,
`openTelegramLink`, `sendData`, button, and haptic calls on `window.__tg`.

Visual runs use a fixed 390x844 viewport, device scale 1, dark mode, `en-US`,
UTC, disabled animation, and awaited self-hosted fonts. Regenerate screenshots
only for an intentional UI change and review every diff.
