# FxAeon HTTP API

The bot exposes a small HTTP surface from the single Express server in
`apps/bot/src/main.ts` (webhook mode, production only). There is **no public
REST API**; every endpoint exists to serve Telegram, the Mini App, and the
hosting platform.

Base URL: the Render service URL (`RENDER_EXTERNAL_URL` / `WEBHOOK_URL`).

## Endpoints

### Mounted directly in `main.ts`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/webhook` | Telegram `X-Telegram-Bot-Api-Secret-Token` (required, timing-safe) | Telegram bot updates (grammY) — **the canonical bot webhook** |
| GET | `/health` | none | Lightweight liveness ping |
| GET | `/api/v1/health` | none | **Real** health checks (DB / Redis / RPC / worker heartbeats). The path Render polls; DB down ⇒ `503` |
| GET | `/api/v1/health/ready` | none | Readiness probe |
| GET | `/api/v1/info` | none | Build/version info |
| * | `/api/v1/miniapp/*` | Privy-verified Mini App session | Mini App data + actions (see below) |

### Mini App router (`/api/v1/miniapp`)

All routes require a verified Mini App session.

| Method | Path | Purpose |
|---|---|---|
| GET | `/market` | Market overview (pools, prices) |
| GET | `/me` | The caller's wallet, settings, and positions |
| POST | `/onboard` | Complete onboarding (server resolves the Privy user from the authenticated Telegram id) |
| POST | `/wallet/sync` | Link the user's embedded wallet read-only |
| POST | `/settings` | Update language / slippage / MEV / notifications |
| POST | `/trade/quote` | Real fx-sdk quote for the trade builder |
| POST | `/trade/execute` | Hand off to a signed Telegram deep-link confirm (the Mini App never broadcasts) |

### `/api` router (`apps/bot/src/api/index.ts`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health`, `/api/health/ready` | none | Same health router (legacy mount) |
| POST | `/api/simulate/trade` | none (rate-limited) | Trade simulation for the Mini App builder |
| POST | `/api/simulate/limit` | none (rate-limited) | Limit-order preview |
| POST | `/api/webhook/telegram` | Telegram secret token | Alternate Telegram webhook mount |
| GET | `/api/webhook/status` | none | Webhook liveness info |
| POST | `/api/limit-orders/prepare` | Mini App session | Build the EIP-712 order payload |
| POST | `/api/limit-orders/submit` | Mini App session | Submit a signed order to the f(x) relay |
| GET | `/api/limit-orders/status/:orderHash` | Mini App session | Order status |
| POST | `/api/limit-orders/cancel-tx` | Mini App session | Build a cancel transaction |

> **Note:** `/webhook` (direct) and `/api/webhook/telegram` both accept Telegram
> updates; `/webhook` is the one registered with `setWebhook`. Likewise
> `/api/v1/health` is the canonical health path Render polls; `/api/health`
> is a legacy alias kept for compatibility.

## Rate limiting

`middleware/rate-limiter.ts` (Redis-backed when `REDIS_URL` is set, in-memory
otherwise):

- global: 100 req/min/IP
- `/api/*`: 60 req/min/IP
- webhook paths: 30 req/sec/IP, **fail-closed** if the limiter store is
  unavailable (Telegram retries with backoff)

## History

There is **no Privy webhook endpoint.** Transaction webhooks are a Privy
enterprise feature the project does not use; the whole svix path was removed
(W-12) and lifecycle is tracked by the W-11 receipt watcher, because the bot
broadcasts every transaction itself. An earlier set of aspirational
`/api/v1/*` stub routes (gas, positions, twap, batch) was never mounted and
was removed in W-13. If a public API ships later, it gets designed
deliberately — with auth — not resurrected from stubs.
