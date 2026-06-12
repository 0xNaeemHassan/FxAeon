# GAPS — Honest Limits & Required Operator Actions

What is **not** verified, not done, or needs a human with production access.
Companion to [COMPLETED.md](./COMPLETED.md). No item here is hidden in a PR
description — this is the single list.

## Operator actions required before/at next deploy

Items 1–7 (workflow hardening, DB migrations, `DATABASE_URL`/`REDIS_URL`
unification, smoke-test secrets, `ADMIN_TELEGRAM_CHAT_ID`) are **done and
verified 2026-06-12** — see git history of this file for the full audit
trail. Still open:

1. **Trigger `fx-upgrade-monitor` once** via *Run workflow* to confirm
   the PR-based flow end-to-end.
2. **Nightly DB backup secrets** (workflow fixed 2026-06-12: pg_dump 17 +
   fail-fast secret guard): add repo secrets `CLOUDFLARE_ACCOUNT_ID`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (R2 token with Object
   Read & Write on the `fxbot-backups` bucket), then *Run workflow* on
   **Backup** and confirm a `.sql.gz` object lands in the bucket.
3. **`SENTRY_DSN`** still unset — optional; error tracking stays off
   until provided.

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

- ~~W-16 onboarding~~ — shipped, then REWORKED to user-owned wallets:
  `/start` → Set-Up-Wallet web_app button → the user creates/imports their
  own embedded wallet via Privy in the Mini App (+ optional revocable
  bot-trading session signer) → backend links it read-only → referral write.
  Operator notes: run `20260611_user_privy_wallet` AND
  `20260612_user_owned_wallets` migrations; create a key-quorum signer in
  the Privy dashboard and set `NEXT_PUBLIC_PRIVY_SIGNER_ID`;
  `PRIVY_POLICY_ID` is no longer used.
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
