# GAPS — Honest Limits & Required Operator Actions

What is **not** verified, not done, or needs a human with production access.
Companion to [COMPLETED.md](./COMPLETED.md). No item here is hidden in a PR
description — this is the single list.

## Operator actions required before/at next deploy

1. **Apply the workflow hardening files** (W-14 part 2). The GitHub App
   token used for this pass lacks the `workflows` scope, so the 7 updated
   files under `.github/workflows/` were delivered out-of-band (zip in DM,
   2026-06-11). Until applied, the old workflows still have broad default
   permissions, tag-pinned third-party actions, and a `fx-upgrade-monitor`
   that pushes to `main` directly.
2. **Run the new DB migration** `20260611_txrecord_idempotency` on the
   production database. The Docker image does **not** run
   `prisma migrate deploy` at boot (deliberate — a money-bot shouldn't
   auto-migrate), and the gated migration job lives in the not-yet-applied
   `deploy.yml`. Until applied, tx idempotency falls back to failing the
   insert path — safe (no duplicate broadcasts) but ugly errors.
3. **Set `ADMIN_TELEGRAM_CHAT_ID`** in Render to receive the daily SLO
   digest, and **`SENTRY_DSN`** if Sentry is wanted. Both optional;
   features stay off when unset.
4. **Trigger `fx-upgrade-monitor` once** via *Run workflow* after applying
   the new workflows, to confirm the PR-based flow end-to-end.

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
- **W-18 portfolio** (on-chain reads as source of truth),
  **W-19 error taxonomy**, **W-21 i18n**
  (all user-facing strings are English-only until then; locale JSON
  untouched by design).

## Smaller honest notes

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
