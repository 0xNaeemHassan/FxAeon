# External API dependencies

Every outbound dependency, what we call it for, and how it is protected.
Primitives live in `apps/bot/src/utils/resilience.ts` (`withTimeout`,
`withRetry` with backoff + jitter, `CircuitBreaker`). Rule of thumb: anything
called from a background loop gets a breaker; anything user-blocking gets a
timeout + bounded retries; nothing retries on 4xx.

| Dependency | Used for | Timeout | Retry | Breaker | Notes |
|---|---|---|---|---|---|
| **Telegram Bot API** (`api.telegram.org`) | All notifications via the `notify()` gate; command replies via grammY | 10s per send | 2 attempts, 500ms base + jitter | `telegram-api` (5 failures → 60s open) | Only `notify()` may push messages outside command handlers. AuditLog row is written **only after** Telegram confirms delivery. |
| **fx limit-order relay** (`fx-limit-order-api.aladdin.club`) | Order submission/cancel mirror (W-09); fill polling via `GET /v1/order-updates?after=` | 10s | 3 attempts, 500ms·attempt + jitter; 4xx (`RelayRejectedError`) is fatal, never retried | `limit-order-relay` (5 → 60s) on the poller | Poller is incremental: one request per 30s for *all* orders, cursor only advances after a successful fetch (1s overlap; DB updates are idempotent). |
| **Ethereum RPC** (`RPC_URL`, viem `PublicClient`) | Quotes/simulation (W-07), `eth_feeHistory` fees and receipt polling (W-11), health reads | viem default per call | Receipt watcher polls every 4s + jitter, 180s budget, returns `timeout` — never guesses an outcome | — (executor fails closed; a watcher timeout leaves the honest `broadcast` state) | Simulation failure or fee-history failure aborts *before* broadcast. |
| **Privy API** (`@privy-io/server-auth`) | Auth verification, wallet create, tx signing/broadcast through the default-deny policy (W-08) | SDK defaults | None — signing/broadcast must never be auto-retried (duplicate-broadcast risk); idempotency keys protect wallet creation and tx records | — | **Transaction webhooks are an enterprise feature we do not have.** The whole svix webhook path was removed in W-12; lifecycle comes from the W-11 receipt watcher, which is equivalent because we broadcast every tx ourselves. `PRIVY_WEBHOOK_SECRET` no longer exists in config. |

## Worker schedule

| Worker | Interval | External calls per tick |
|---|---|---|
| `health-monitor` | 5 min | 0 (DB only) + Telegram via `notify()` (30-min throttle; urgent: 10-min, bypasses quiet hours) |
| `limit-order-poller` | 30s | 1 relay request (breaker-guarded) + Telegram via `notify()` for state changes |

Cost note: this keeps us comfortably inside the free tiers — one relay call
per 30s (~2.9k/day) and Telegram pushes are free.
