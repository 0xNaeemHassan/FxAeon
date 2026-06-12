# FxAeon HTTP API

The bot exposes a small HTTP surface from the single Express server in
`apps/bot/src/main.ts` (webhook mode, production only). There is **no public
REST API**; everything below exists to serve Telegram, Privy, the Mini App,
and the hosting platform.

Base URL: the Render service URL (`RENDER_EXTERNAL_URL`).

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/webhook` | Telegram `X-Telegram-Bot-Api-Secret-Token` (required) | Telegram bot updates (grammY) |
| POST | `/privy-webhook` | SVIX HMAC signature (required, fail-closed) | Privy transaction webhooks |
| POST | `/api/webhook/privy` | SVIX HMAC signature (required, fail-closed) | Privy webhooks (router-mounted alias) |
| GET | `/api/webhook/status` | none | Webhook liveness info |
| GET | `/health` | none | Basic health check |
| GET | `/api/health` | none | Health router |
| GET | `/api/v1/health` | none | Alias kept for Render health checks |
| POST | `/api/simulate` | none (rate-limited) | Trade simulation for the Mini App — **not execution-grade until W-07** |

## Rate limiting

`middleware/rate-limiter.ts` (Redis-backed when `REDIS_URL` is set, in-memory
otherwise):

- global: 100 req/min/IP
- `/api/*`: 60 req/min/IP
- webhook paths: 30 req/sec/IP, **fail-closed** if the limiter store is
  unavailable (Telegram/SVIX retry with backoff)

## History

A set of aspirational `/api/v1/*` routes (gas, positions, twap, batch) was
documented here previously against a fictitious `api.fxbot.io` domain. Those
routers were never mounted and were removed in W-13. If a public API ships
later, it gets designed deliberately — with auth — not resurrected from stubs.
