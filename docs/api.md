# HTTP API

The API is an internal application surface, not a supported public developer API. The process starts Express in both modes: production mounts the Telegram webhook and receives updates there; development/test serves the API while grammY receives Telegram updates by long polling.

Base URL is the bot service origin. JSON error shapes are not globally uniform across all legacy routes, so clients should branch on HTTP status and then inspect `error.code` or `error.message` when present.

## Direct routes

| Method | Path | Authentication | Purpose |
|---|---|---|---|
| `POST` | `/webhook` | Telegram `X-Telegram-Bot-Api-Secret-Token` checked by grammY | Canonical Telegram update webhook |
| `GET` | `/health` | None | Process liveness only |
| `GET` | `/api/v1/health` | None | Deep database/Redis/Ethereum RPC/Base RPC/selected-worker status |
| `GET` | `/api/v1/health/ready` | None | Database readiness |
| `GET` | `/api/v1/health/deps` | None | Flat `db`, `redis`, `rpc`, and `baseRpc` state for Mini App health chips |
| `GET` | `/api/v1/info` | None | Name, version, environment, uptime, timestamp |

`/health` should gate whether the process can answer HTTP. `/api/v1/health` returns 503 only when the database is unhealthy; Redis/RPC/worker failures produce a 200 response with `status: "degraded"`. Base RPC is optional while bridge execution is off, but a missing Base RPC becomes unhealthy in the response when bridge execution is requested.

## Mini App API

Prefix: `/api/v1/miniapp`

Every route requires:

```http
Authorization: tma <raw Telegram WebApp initData>
```

The backend verifies the Telegram HMAC, user object, and timestamp. Data older than six hours or more than five minutes in the future is rejected with 401. This authenticates the Telegram user; it is not a Privy access token.

| Method | Path | Request | Purpose |
|---|---|---|---|
| `GET` | `/market` | — | Cached market overview; 503 if upstream and cache fail |
| `GET` | `/protocol` | — | SDK-backed fxSAVE config plus canonical token metadata |
| `GET` | `/me` | — | Account settings, funding, positions, fxSAVE, and complete-if-priceable supported-asset portfolio total |
| `POST` | `/onboard` | `{ "referral"?: string }` | Resolve/link embedded wallet from Privy; body cannot choose address |
| `POST` | `/wallet/sync` | `{}` | Re-resolve wallet delegation/import state from Privy |
| `POST` | `/settings` | Any of `language`, integer `slippageBps` 1–200, `mevProtection` `on`/`off` | Update validated account settings |
| `POST` | `/action/quote` | One action intent | Build, ownership-check, policy-check, simulate, and freeze one exact SDK workflow for two minutes |
| `POST` | `/action/execute` | `{ "ticket": "...", "feeTier"?: "slow" | "market" | "fast" }` | Claim the wallet-bound frozen plan and execute it through the source-chain executor |
| `GET` | `/activity?take=30` | `take` is clamped to 1–50 | Wallet-scoped recent `TxRecord` journal |

Quote uses action intent fields. For example:

```json
{
  "kind": "position_open",
  "market": "wstETH",
  "side": "long",
  "inputToken": "ETH",
  "amount": "0.25",
  "leverage": 3
}
```

Long leverage must be 1.1–7; short leverage 1.1–3. A successful quote returns an opaque 32-byte base64url `ticket`, `expiresAt`, review details, source chain, MEV state, and slow/market/fast gas estimates. The server stores the exact validated intent, wallet, action kind, chain ID, ordered targets, calldata, values, bridge scope, and per-tier worst-case fee budgets (including execution gas headroom) behind that ticket. It expires exactly two minutes after creation.

Execute sends only the ticket and a named `feeTier`; an omitted tier defaults to `market`, while an unknown value is rejected. Raw fee values, targets, calldata, wallet address, chain ID, and replacement action fields are not accepted from the browser. The selected tier is re-derived from fresh fee history and must remain within the frozen reviewed budget; otherwise the user must quote again. Initial routes also fail above 1,000 gwei max fee per gas or 0.5 ETH worst-case aggregate network fee. The first confirmation claims the ticket before fee/RPC/broadcast work. Its immutable server ID becomes `miniapp-action:<user-id>:<ticket-id>`, so retry/double-tap races resolve the same per-user `TxRecord` and cannot create a second economic execution. There is no parallel `/trade/quote` or `/trade/execute` money path.

### Unified action intents

`kind` selects a closed union. Decimal amounts are strings so JSON number rounding cannot silently change token units.

| `kind` | Required intent fields | Constraints |
|---|---|---|
| `position_open` | `market`, `side`, `inputToken`, `amount`, `leverage` | Wallet address, target, route, and fees are server-derived |
| `position_increase` | `market`, `side`, `positionId`, `inputToken`, `amount` | Position ownership and current leverage are re-read |
| `position_reduce` | `market`, `side`, `positionId`, `outputToken`, `fractionBps` | `fractionBps` is integer 100–10000; unit conversion is server-side |
| `position_adjust` | `market`, `side`, `positionId`, `leverage` | Position ownership and leverage bounds are checked |
| `mint` | `market`, `positionId`, `depositToken`, `depositAmount`, `mintAmount` | `positionId=0` creates; nonzero must be an owned long position |
| `repay_withdraw` | `market`, `positionId`, `repayAmount`, `withdrawToken`, `withdrawAmount` | `repayAmount` may be `"all"`; zero is allowed for one leg only |
| `save_deposit` | `tokenIn`, `amount` | Token is `fxUSD`, `USDC`, or `fxUSDBasePool` |
| `save_withdraw` | `tokenOut`, `shares`, `instant` | Shares may be `"all"`; for `fxUSDBasePool`, `instant` must be `false` and means immediate direct ERC-4626 `redeem`, not a cooldown request |
| `save_claim` | — | Requires a real matured pending redemption |
| `bridge` | `token`, `amount`, `direction` | Token is `fxUSD`/`fxSAVE`; direction is `ethereum_to_base`/`base_to_ethereum` |

Position markets are `wstETH` and `WBTC`; sides are `long` and `short`. Token compatibility and decimals come from `packages/shared/src/protocolTokens.ts`, not from the browser. Quote responses contain a human review description, detail rows, warning when relevant, source network, MEV state, chain-derived gas tiers, the ticket, and its expiry. Execute responses use one unified idempotent action-result shape.

Common execution responses:

- `400 BAD_QUOTE_TICKET`: ticket is absent or malformed.
- `409 BOT_TRADING_OFF`: no active Privy session-signer grant.
- `409 BRIDGE_EXECUTION_DISABLED`: bridge gate is off; no transaction was sent.
- `410 QUOTE_TICKET_EXPIRED`: the two-minute review window elapsed; quote again.
- `422 QUOTE_TICKET_INVALID`: ticket is not bound to the authenticated user/current wallet, or its frozen plan is invalid.
- `422`: route, simulation, fee, broadcast, or receipt-stage execution failure.
- success includes `deduped`, durable status, every persisted transaction hash, record ID, chain ID, and best-effort detailed receipt data for the final confirmed hash. A submitted route can return success-shaped data with `broadcast`, `partial`, `cancelled`, or `reverted` status so the client can show the on-chain journal instead of mislabeling it as a preflight failure.

`GET /activity` returns the durable record plus `hashes` and ordered `steps[]` (`index`, receipt-derived `status`, and `hash`). It therefore exposes every route transaction for explorer/receipt verification even though the execute response's detailed `receipt` object currently describes only the final confirmed hash. Terminal states are immutable: retrying after `failed`, `reverted`, `partial`, or `cancelled` requires a fresh quote/ticket. A receipt timeout stays `broadcast` and duplicate calls report the same pending record.

## Legacy `/api` router

| Method | Path | Authentication | Purpose/status |
|---|---|---|---|
| `GET` | `/api/health[/ready|/deps]` | None | Legacy mount of the health router |
| `POST` | `/api/simulate/trade` | Telegram Mini App HMAC | SDK route + ordered simulation for the authenticated user's wallet |
| `POST` | `/api/simulate/limit` | None | Returns 410; moved to limit-order routes |
The old `/api/webhook/telegram` compatibility stub and static `/api/webhook/status` response have been removed. Register only the direct `/webhook` handler with Telegram.

### Trade simulation request

```json
{
  "address": "0x...",
  "market": "wstETH",
  "side": "long",
  "leverage": 3,
  "amountWei": "250000000000000000",
  "slippageBps": 50
}
```

This endpoint does not broadcast. It requires fresh `Authorization: tma <initData>`, an onboarded user, and an `address` equal to that user's stored wallet.

## Limit-order primitives

Prefix: `/api/limit-orders`

Every route requires the same `Authorization: tma <initData>` header as the Mini App API and an onboarded user. The authenticated database wallet is authoritative.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/prepare` | Require `maker` to equal the authenticated wallet; validate a known pool/order, read nonce, chain-check EIP-712 hash, return typed data |
| `POST` | `/submit` | Require authenticated maker; recover signature, re-check hash, submit to official relay, record order |
| `GET` | `/status/:orderHash` | Read execution state from chain |
| `POST` | `/cancel-tx` | Return calldata for an authenticated maker's one-order cancel, or the generic maker-nonce increment |

These remain **backend primitives**, not a supported end-user workflow: neither Telegram nor the Mini App signs the returned typed data or cancellation transaction. Authentication and maker binding prevent arbitrary-wallet preparation/relay, but do not turn the HTTP surface into a stable public API. `/limit` in chat does not call it.

## Admin API

Prefix: `/api/v1/admin`

All routes require `Authorization: Bearer <ADMIN_TOKEN>`. When `ADMIN_TOKEN` is unset, every request returns 403.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/rewebhook` | Immediately force Telegram webhook re-registration |
| `GET` | `/policy-mode` | Return the process policy mode and `mutable: false` |
| `POST` | `/policy-mode` | Always 405; policy changes require reviewed environment configuration and restart |
| `GET` | `/stats` | User, transaction, and legacy position counts |

Signer policy is deliberately immutable at runtime. Set `SIGNER_POLICY_MODE`, pass production validation (`enforce` is mandatory there), and restart. The admin API cannot weaken it in a running process.

Current user transaction routes do not charge an FxAeon application fee. There is no fee-mode control.

## HTTP controls

- Helmet headers and HSTS are enabled.
- CORS permits the configured `MINI_APP_URL` origin; CORS is not authentication.
- HTTP limits are 100 requests/minute/IP globally, 60/minute/IP for API paths, and 30/second/IP for webhook paths.
- Redis-backed decisions have a 250 ms deadline and fall back to in-process limiters. Multi-replica limits are weaker without healthy Redis.
- `executeRoute` enforces `DAILY_TX_CAP` after successful simulation and before broadcast. It first counts the user's persisted UTC-day records that have a hash, then consumes a Redis-backed live counter or an in-process fallback; an unavailable database check fails closed. One ordered route consumes one action even if it contains multiple transactions. The live point is consumed before fee estimation, so a later pre-hash failure can still spend that point until the counter resets. This is not a value ceiling and does not cover the separate Ethereum speed-up/cancel path.
- Request logs include method/path/status/duration/IP. Logger redaction covers common secret fields, but operators should still avoid sensitive request bodies.
