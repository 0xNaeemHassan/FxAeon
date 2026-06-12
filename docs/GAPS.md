# GAPS — Honest Limits & Required Operator Actions

What is **not** verified, not done, or needs a human with production access.
Companion to [COMPLETED.md](./COMPLETED.md). No item here is hidden in a PR
description — this is the single list.

## Operator actions required before/at next deploy

1. ~~Apply the workflow hardening files~~ — **done** (verified 2026-06-12):
   all 7 hardened workflows live under `.github/workflows/` on `main`
   (least-privilege `permissions:`, SHA-pinned third-party actions,
   PR-based `fx-upgrade-monitor`).
2. ~~Run the new DB migrations~~ — **done** (verified 2026-06-12): the
   gated `deploy.yml` migration job runs on `main` pushes
   (`DEPLOY_DB_ENABLED=true`) and reports "3 migrations found … No pending
   migrations to apply" against production.
3. ~~Fix `DATABASE_URL` on Render~~ — **done** (verified 2026-06-12):
   switched to the Supabase Session pooler string. Follow-up the same day:
   the Render env and the GitHub `DATABASE_URL` secret pointed at *two
   different* databases (deep health's new `databaseHint` reported
   `schema-missing`); both now unified to the same Session pooler string
   so migrations and the runtime hit the same database.
4. ~~Set `REDIS_URL` on Render~~ — **done** (verified 2026-06-12): the
   Upstash `rediss://` TCP string is in place; deep health reports
   `redis: healthy` and `/api/v1/health` returns overall `healthy`.
5. ~~Apply the 3 updated workflow files~~ — **done** (applied to `main`
   2026-06-12; CI/Deploy/Secret Scan green on the apply commit).
6. ~~Set GitHub repo secrets for the smoke test~~ — **done** (2026-06-12):
   `PRODUCTION_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
   are set; the post-deploy smoke test now runs for real. Still optional:
   `SLACK_WEBHOOK_URL` for failure pings,
   `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` if the wrangler deploy
   path should run (Cloudflare Pages Git integration already deploys the
   mini-app without it).
7. ~~Set `ADMIN_TELEGRAM_CHAT_ID`~~ — **done** (2026-06-12); the daily
   SLO digest will go to that chat. **`SENTRY_DSN`** still unset —
   optional; error tracking stays off until provided.
8. **Trigger `fx-upgrade-monitor` once** via *Run workflow* to confirm
   the PR-based flow end-to-end.

## Not verified (and why)

- **Live Telegram delivery.** Notification sends, the SLO digest, and
  health alerts are unit-tested against a fake `sendFn`; no real message
  was pushed to a production chat. First real send happens in production.
- **Sentry event delivery.** `beforeSend` scrubbing is unit-tested; an
  actual event reaching a Sentry project needs a real DSN.
- **Privy-signed broadcast end-to-end.** `executeRoute` calls Privy's
  signing API directly; that cannot run against an Anvil fork without
  refactoring signing behind an injectable interface (not worth the risk
  right now). Everything around it — idempotency, state machine, fee
  derivation, simulation gate — is fork-verified; the Privy signing call
  itself is verified only by the existing live wallet setup (W-08).
- **Funded-account fork trade.** The quoted wstETH route fails closed at
  the funding step for an unfunded account (expected). A full fork trade
  needs whale-impersonated collateral funding; deferred — the simulation
  gate, which is what protects real funds, is what mattered to prove.
- **Render runtime behavior** of the new `/api/v1/health` (e.g. Render
  restarting on 503): observable only after the next production deploy.

## Known product debt (P2 — in progress, owner go-ahead 2026-06-11)

- ~~W-16 onboarding~~ — shipped: `/start` → Create-Wallet web_app button →
  policy-guarded server-side wallet creation → referral write →
  funded-address empty states. New operator note: run the
  `20260611_user_privy_wallet` migration with the W-11 one.
- ~~W-17 trade-UX~~ — landed (PR #51): inline ladder, signed short-TTL
  intents, server-side confirm with status edits; first production caller
  of the W-11 executor and first callback_query handler in the bot.
- ~~W-20 TMA platform~~ — landed (PR #50): telegram-web-app.js loaded,
  typed platform helpers, lazy Privy, Lighthouse budget.
- ~~W-18 portfolio~~ — landed (PR #52): on-chain reads as source of
  truth, fixed inverted risk meter, per-position Close flow.
- ~~W-19 error taxonomy~~ — landed: execution failures now classified
  by broadcast state first (simulation failures say "NOT sent"; reverts
  link the tx hash) with actionable causes; mini-app build errors no
  longer ignored; SECURITY.md audit table replaced with honest text.
- ~~W-21 i18n~~ — landed: single canonical Fluent catalog dir
  (`apps/bot/src/i18n/locales/*.ftl`, 6 locales) wired through
  `@grammyjs/i18n` keyed off `User.language` (60s per-user cache,
  Telegram `language_code` fallback, fail-soft to English); the two stale
  JSON locale dirs (dead code with pre-W-16 copy and the wrong bot
  username) deleted; CI enforces key + variable parity across locales.

## Smaller honest notes

- i18n coverage is partial by design (W-21): `/start`, `/help`, `/settings`,
  the `/trade` usage screen and the `/portfolio` empty state are fully
  translated. Still English-only: the remaining command flows (limit,
  orders, mint, save, refer, security, deposit/withdraw/bridge, auto),
  trade/close status edits, W-19 error-taxonomy strings, funding-state
  lines, and notifications. The catalog + parity tests make extending
  coverage mechanical; better to ship honest partial coverage than to
  machine-translate execution-path error copy without review.

- Mini-app TTI budget is a measured baseline, not the goal: the W-20 budget
  (TTI < 2.5s on 3G-Fast/mobile) was written while Lighthouse CI couldn't
  actually run (pnpm conflict, then NO_FCP). First real runs (2026-06-11,
  after the first-paint fix) measure best-of-3 TTI at ~3.2s (index) /
  ~3.4s (login). The error budget is set at 4.0s to catch regressions;
  getting to 2.5s needs real bundle work (React+Next baseline is ~105 kB
  shared first-load JS).

- In-process metrics reset on every deploy/restart; the daily digest says
  so. Fine for one Render instance; revisit only if instances > 1.
- The fx-sdk vendored bundle still contains debug `console.log`s; we
  suppress the known `poolData-->` line at runtime. If the SDK adds new
  ones, they'll appear in logs until added to the filter (or fixed
  upstream — better).
- `scripts/fork-verify.ts` needs a local Anvil fork and is a manual tool,
  not wired into CI (public-RPC forking in CI would be slow and flaky).
- Old git history still contains the pre-rotation secrets (W-01). They are
  rotated and dead; rewriting history was judged not worth breaking
  clones. gitleaks prevents re-introduction.
