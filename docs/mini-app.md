# Telegram Mini App

The Mini App is a Next.js 15 static export designed for Telegram's mobile webview. It is not a public account dashboard: private account data and execution routes require Telegram's signed WebApp `initData`, and wallet controls require a correctly configured Privy application.

## Routes

| Route | Purpose | State-changing behavior |
|---|---|---|
| `/` | Detect Telegram context and route to onboarding or portfolio | None |
| `/login` | Telegram/Privy login, create or import an embedded wallet, optional session-signer grant, backend link | Links account/wallet; no protocol transaction |
| `/portfolio` | Wallet, live balances, supported-asset portfolio/PnL estimates, positions, fxSAVE state, and market overview | Read-only |
| `/trade` | Select market, side, input asset, leverage, and amount | Opens a new leveraged position through the backend executor |
| `/positions` | Select a wallet-owned position and add capital, reduce/close it, or change leverage (long 1.1–7×, short 1.1–3×) | Executes the selected existing-position action |
| `/borrow` | Open/add to a collateralized fxUSD position, repay debt, and optionally release collateral | Executes mint or repay/withdraw routes |
| `/earn` | Live fxSAVE exchange/cooldown/fee data; deposit, instant/queued redeem, direct Base Pool redeem, and claim | Executes the complete SDK fxSAVE lifecycle; `fxUSDBasePool` redemption is immediate ERC-4626 redeem, not cooldown |
| `/move` | Select fxUSD/fxSAVE, direction, and amount for Ethereum↔Base | Quotes both implemented directions; execution remains disabled by default and release-gated even when both RPCs exist |
| `/activity` | Wallet-scoped all-step executor journal and transaction links | Read-only |
| `/more` | Hub for positions, borrowing, activity, receive, settings, policy, bot, and protocol resources | None by itself |
| `/qr` | Ethereum deposit address and QR code | None |
| `/settings` | Language, slippage, MEV mode, wallet identities, session-signer grant/revoke, logout | Updates settings/delegation; no protocol transaction by itself |
| `/policy` | User-facing custody and execution explanation | None |

The five-item navigation is Home, Trade, Earn, Move, and More. Positions and Borrow are grouped with Trade; Receive is grouped with Move; Activity and Settings are grouped with More. The shell tracks Telegram's stable viewport, safe areas, haptics, and native BackButton. It deliberately renders one dark product theme and does not currently mirror action controls into Telegram's native MainButton.

## Launch contexts

Telegram has multiple Mini App launch modes:

- Menu-button, inline-button, and direct Mini App launches normally include signed `initData`. These use the authenticated HTTP API.
- Reply-keyboard `web_app` launches can have empty `initData` but allow `sendData()`. Onboarding falls back to the bot data channel in that case.
- A normal browser launch has neither trusted channel. The UI directs the user back to Telegram.

Account API calls send:

```http
Authorization: tma <raw Telegram initData>
```

The backend verifies the HMAC with the Telegram bot token, requires a user record in the payload, rejects timestamps more than five minutes in the future, and rejects data older than six hours.

## Onboarding lifecycle

1. Verify that the app is inside Telegram and that `NEXT_PUBLIC_PRIVY_APP_ID` is present.
2. Authenticate/link Telegram with Privy.
3. Let the user create or import an Ethereum embedded wallet.
4. Optionally add the signer identified by `NEXT_PUBLIC_PRIVY_SIGNER_ID`.
5. Call `/onboard` when `initData` is available or send `wallet_connected` through Telegram's `sendData()` channel.
6. The backend looks up the Privy user by verified Telegram identity and stores the embedded wallet it finds there.

The flow has a 30-second convergence guard that offers a restart path if an intermediate Privy step stalls.

## Action lifecycle

1. Enter an intent on Trade, Positions, Borrow, Earn, or Move. The browser sends symbols, quantities, position IDs, direction, and other constrained intent fields—not calldata, target addresses, fees, or an execution wallet.
2. `POST /api/v1/miniapp/action/quote` validates the shape, re-reads ownership and action-specific protocol state, asks the SDK for a fresh route, applies the signer policy, simulates the complete ordered route (including balance/allowance failure), and derives slow/market/fast gas tiers.
3. The server freezes that exact validated intent, wallet, action kind, source chain, ordered targets/calldata/values, bridge scope, and each displayed tier's worst-case fee (including the executor's 20% gas headroom) in an `ActionQuoteTicket`. The opaque ticket and countdown expire exactly two minutes after creation.
4. Review the SDK/chain-derived details, warning, network, MEV mode, and selected fee tier. Nothing is signed during review. Expiry disables confirmation and requires a fresh quote.
5. Confirm sends only the ticket and selected tier to `/action/execute`. The server revalidates the ticket's user/wallet binding and delegation, claims it, reapplies policy, and simulates the frozen plan again; it does not silently rebuild a different route after review.
6. The server enforces the UTC-day logical-action cap and derives the selected tier again from fresh fee history. If its worst-case cost now exceeds the reviewed maximum, execution stops and requires a fresh review. Initial transactions also have independent 1,000-gwei and 0.5-ETH worst-case safety ceilings. Otherwise the route broadcasts sequentially. The ticket ID is the executor idempotency key, so repeated confirmation can only resolve the same transaction record rather than create a duplicate broadcast.
7. Every route-step hash and receipt-derived status is persisted. The result and Activity screen distinguish still-pending `broadcast`, terminal `confirmed`, `reverted`, `partial`, `cancelled`, and pre-broadcast `failed` outcomes and link every recorded hash.

All current protocol screens use the unified action endpoints; the duplicate legacy trade endpoints were removed. Wallet withdrawals, alerts/automation, pending-transaction replacement, and limit-order signing remain Telegram-only or unavailable as described in the [capability matrix](sdk-capabilities.md).

## Product workflows

- **Trade:** open wstETH or WBTC long/short positions with any server-approved SDK input token and leverage inside the shared risk limits.
- **Positions:** ownership-check the selected on-chain position; increase it, reduce 1–100%, close fully, or adjust leverage. Short reductions use the SDK's debt-normalized units rather than collateral units.
- **Borrow:** create or add to long collateral positions with ETH/WETH/stETH/wstETH or WBTC, mint fxUSD, repay some/all debt, and optionally withdraw collateral.
- **Earn:** use fxUSD, USDC, or `fxUSDBasePool`. fxUSD/USDC support the protocol's queued or instant paths. Selecting `fxUSDBasePool` uses an immediate direct ERC-4626 vault redemption; it creates no cooldown request and has nothing to claim later.
- **Move:** use the SDK-pinned fxUSD/fxSAVE OFT code path between chain 1 and chain 8453. Quote/build/broadcast is disabled by default; the screen still shows honest chain-specific balances and the paused state. Turning on the flag and supplying both RPCs only removes the software gate; operators must still obtain funded source-chain and destination-delivery evidence before treating the bridge as ready.
- **Activity:** list up to 50 recent executor records for the authenticated user, with every persisted step hash and status. A missing receipt remains pending, an earlier landed step plus later pre-broadcast failure is `partial`, and a mined cancellation is `cancelled`; none is represented as success.

## Data honesty and degraded states

- `/me` reads funding, positions, fxSAVE, and prices independently.
- The hero values every supported wallet-token balance plus position net equity and fxSAVE redeemable assets. fxSAVE is excluded from wallet cash to avoid double-counting. The value is emitted only when all relevant balance reads, positions, savings, and required prices are known; a positive unpriced supported token—including fxUSD—makes it unavailable. Arbitrary ERC-20s outside the supported registry are not included.
- `positionsKnown` and `savingsKnown` distinguish a real empty state from an RPC/SDK failure.
- Missing prices produce null USD/PnL fields. fxUSD wallet cash, position debt/collateral, and fxSAVE underlying all require the live `FXUSD` feed entry; the backend does not assume a $1 peg.
- `/market` returns 503 when both upstream data and cache are unavailable.
- `/protocol` reads fxSAVE configuration and the canonical token matrix from the SDK/server registry; the UI does not invent APY.
- Missing Telegram auth, backend URL, Privy app ID, or signer ID has a dedicated configuration/degraded screen.

## Wallet controls

The user can view the embedded execution wallet, grant or revoke bot trading, export through Privy's UI, link additional login identities/wallets, and log out of the local Privy session. After a grant or revoke, `/wallet/sync` asks the backend to resolve the current Privy state; the browser cannot declare itself delegated.

## Build-time environment

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_BOT_API_URL` | Explicit backend origin; an empty value disables authenticated API calls in current client source |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | Telegram deep links, without `@` |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Wallet authentication/onboarding |
| `NEXT_PUBLIC_PRIVY_SIGNER_ID` | Session-signer grant/revoke target |

All are embedded in the static build. `NEXT_PUBLIC_MINI_APP_URL` and `NEXT_PUBLIC_ALCHEMY_RPC_URL` are legacy names and are not read by current Mini App source.

## Test locally

```bash
pnpm --filter @fxaeon/shared build
pnpm --filter @fxaeon/mini-app test
pnpm --filter @fxaeon/mini-app exec playwright install chromium
pnpm --filter @fxaeon/mini-app test:e2e
```

Playwright builds and serves the static export on port 4321, injects a deterministic Telegram WebApp shim, and intercepts Mini App API calls. It verifies real page logic and visual snapshots; it does not prove live Telegram, Privy, RPC, or f(x) integration.
