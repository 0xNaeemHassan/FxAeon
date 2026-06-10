# FxAeon — SLOs & Measurement Plan

**Principle:** every SLO below must be measurable with the existing stack (pino + Postgres + Redis; Sentry/PostHog when wired) at ≤ $21/mo @ 500 MAU. No new paid observability services — measurement rides on structured logs and a few DB counters.

---

## 1. Service-Level Objectives

### Bot responsiveness
| SLO | Target | Measurement |
|---|---|---|
| Command response p95 | **< 1.5 s** | pino per-command timing log (`{cmd, ms, userId-hash}`) emitted by a grammY middleware wrapper; aggregate from logs (Render/Fly log drain → daily script or Logtail free tier). |
| Command response p99 | **< 3 s** | same source, p99 rollup. |
| Webhook → first byte | < 500 ms p95 | existing Express response-time middleware (`middleware/index.ts`) already logs `duration` — keep, add route label. |

### Mini App
| SLO | Target | Measurement |
|---|---|---|
| TTI on 3G Fast | **< 2.5 s** | Lighthouse CI (free, GH Actions) on the Pages deploy with mobile/3G-Fast profile; budget asserted in CI. |
| JS bundle (initial route) | < 350 KB gz | `next build` output check in CI; Privy SDK lazy-loaded behind auth gate. |

### Trade execution integrity
| SLO | Target | Measurement |
|---|---|---|
| Simulation success rate (of attempted sims) | **> 98%** | counter pair in Redis (`sim:ok` / `sim:fail` daily keys) incremented at the single simulation gate; surfaced in `/health` JSON. |
| On-chain failure rate (reverted / broadcast) | **< 1%** | `TxRecord` statuses (`reverted`/total) per 7-day window — SQL view; alert when > 1%. |
| Duplicate trade executions | **0 per 7 days** | idempotency-key violations logged as `dup_intent_blocked` (expected, fine) vs. *post-hoc* duplicate detection: SQL check for >1 confirmed tx per intent hash — must be zero. |
| Tx stuck > 5 min (pending, no replacement) | < 0.5% | state-machine timestamps in `TxRecord` (`broadcastAt`, `minedAt`, `confirmedAt` — columns to add in Phase 3). |

### Reliability
| SLO | Target | Measurement |
|---|---|---|
| Sentry unhandled error rate | **< 0.5% of updates** | Sentry free tier (5k events/mo fits 500 MAU); scrubbers mandatory before enabling (THREAT_MODEL §4). |
| Worker liveness | heartbeat gap < 2× interval | each worker `SET worker:<name>:hb <ts>` in Redis; `/health` reports stale heartbeats; external uptime ping (UptimeRobot free) on `/health`. |
| Webhook auth rejections | tracked, alert on spikes | counter on 401s (spike = someone probing or Telegram secret drift). |

### Funnel / product
| SLO | Target | Measurement |
|---|---|---|
| Onboarding completion (/start → wallet created) | **> 60%** | two AuditLog events (`onboarding_started`, `wallet_created`); SQL funnel. PostHog optional later (free tier OK) — not required. |
| First trade within 24h of wallet | > 25% | AuditLog join. |
| Notification opt-out rate | < 10% | `NotificationPref` aggregates. |

---

## 2. Measurement infrastructure to build (Phase 3 items)

1. **Command timing middleware** (grammY) — one file, logs `{cmd, ms, ok}` structured; no PII (hash telegramId).
2. **Single simulation gate** — all broadcasts pass through one function that increments sim counters and refuses unsimulated calldata. The counters *are* the metric source.
3. **TxRecord state-machine columns** — `broadcastAt/minedAt/confirmedAt/replacedBy` + status enum; enables failure-rate and stuck-tx SQL with zero new infra.
4. **`/health` v2** — JSON: DB ping, Redis ping, RPC block number + lag, worker heartbeats, sim counters (24h), version/commit. UptimeRobot watches it.
5. **Lighthouse CI job** — runs on mini-app deploys; asserts TTI + bundle budgets.
6. **Daily SLO rollup** — one cron (GH Actions, free) running the SQL views and posting a digest (Telegram message to the admin chat — no new services).

## 3. Error budget & alerting policy

- **Page (Telegram DM to admin) immediately:** duplicate-execution detection ≠ 0; webhook auth disabled/missing at boot; sim success < 95% over 1h; RPC lag > 10 blocks for 5 min.
- **Daily digest:** p95/p99, failure rates, funnel, worker heartbeat history.
- **Budget rule:** if on-chain failure rate exceeds 1% for a 7-day window, feature work pauses and the cause gets a postmortem in `ops/runbooks/`.

## 4. Cost guard

| Item | Cost |
|---|---|
| Render starter (bot) | ~$7/mo |
| Supabase / Upstash / Cloudflare Pages | free tiers |
| Alchemy | free tier (monitor CU usage in daily digest; fallback transport reduces burn) |
| Sentry / UptimeRobot / Lighthouse CI / GH Actions | free tiers |
| **Total** | **~$7/mo** — within the $21 ceiling; any paid addition requires an ADR per the project rules. |
