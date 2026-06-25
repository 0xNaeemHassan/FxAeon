# FxAeon — Product Deficiencies vs. the Telegram Trading-Bot Bar

**Benchmark set:** Photon, BONKbot, Maestro, Banana Gun — the bots that set user expectations for speed, confirmation flows, and "it just works" onboarding. f(x) leveraged positions are more complex than memecoin sniping, which makes clarity and confirmation UX *more* important, not less.

**Honest summary:** FxAeon currently has the *skeleton* of a competitive bot (command set, schema, mini-app pages) but none of the muscle. Every flow below dead-ends before value delivery. That's the gap to close — and it's closable, because the hard architectural choices (Privy, grammY, Mini App, BullMQ) are sound.

---

## 1. Onboarding

**Today:** `/start` sends two text messages. "Step 1: Connect Wallet" has **no button, no link, no wallet creation** (`createWallet()` returns the string `'0x...'`). A new user literally cannot proceed. Returning-user detection works (DB lookup) but no user can ever become "returning."

**The bar (Photon/Maestro):** tap bot → wallet exists → funded address + balance shown → first trade possible in <60 seconds, all inside Telegram.

**Required:**
- `/start` → inline keyboard: **[🚀 Create Wallet]** (web_app button → Mini App Privy flow) + **[❓ How it works]**.
- On wallet creation: callback to bot (validated initData, not raw `sendData`) → persist user → show address + QR + "deposit ETH/wstETH to begin."
- Empty-state coaching: after wallet exists but balance = 0, every command should answer with the deposit address, not an error.
- Referral capture already parses `ref_` payloads — wire it to the `referralCode` column it never writes.

## 2. /trade flow

**Today:** parses args, validates market against `MARKETS`, replies with a text "preview" ending in "Use the Mini App to sign and submit" — with **no link to the Mini App**. The Mini App trade page then broadcasts an empty-calldata tx (AUDIT P0-2) and celebrates success.

**The bar:** inline buttons for market/side/leverage, live numbers (entry price, liq price, fees, slippage), one confirm tap, real-time status edits of the same message (`pending → confirmed` with explorer link).

**Required:**
- Inline keyboard ladder: market → side → leverage (respect 7x/3x caps) → amount presets (25/50/100% of balance) → **[Open Long 3x ▸]** web_app deep link carrying a *signed* param payload.
- Preview must show **real** numbers: oracle price, simulated gas, liq price from pool params — all from one shared quote endpoint (no `currentPrice = 3000`).
- Single source of truth for position math in `@fxaeon/shared`, used by bot preview *and* mini-app confirm (today they would diverge).
- Post-broadcast: edit the original message with status transitions instead of sending new messages.

## 3. /limit flow

**Today:** text preview only; no keyboard, no deep link; mini-app page signs a struct with zeroed deltas and a placeholder orderHash (AUDIT P0-6). `/orders` (list) reads the DB honestly — the one fully-wired read path in the command set.

**Required:**
- Same keyboard ladder pattern as /trade; TP/SL presets (±5/10/25%) — competitors make TP/SL a two-tap action from the position view.
- Show *trigger distance from current oracle price* and warn when an order would execute immediately.
- Fill notification (the poller exists; the notification is a comment — AUDIT P1-4).

## 4. /portfolio

**Today:** reads `Position` rows and formats them — but nothing ever *writes* positions (no execution, no chain indexer), so it permanently shows the empty state. Health %, PnL columns exist in schema only.

**The bar:** live position cards (entry/mark/liq price, PnL with %, health bar), one-tap close / add-collateral buttons per card.

**Required:**
- On-chain position reads via PoolManager/pool contracts as source of truth (DB as cache, reconciled per block range) — never trust DB-only state for money display.
- Per-position inline buttons: **[Close]** **[±Collateral]** **[TP/SL]**.
- Health-bar rendering (▰▰▰▱▱) and red/yellow/green emoji thresholds aligned with `HEALTH_LEVELS`.

## 5. Error UX

**Today:** generic `❌ An error occurred. Please try again.` everywhere; one flow distinguishes user-rejection. No error taxonomy, no recovery hints, no support path.

**Required:** error map → user-actionable copy: insufficient gas ("You need ~0.004 ETH more for gas — deposit to 0x…"), slippage exceeded ("Price moved 0.8% — retry with 1% slippage? [Retry]"), RPC down ("Network congestion — your funds are safe, nothing was sent"), simulation revert (decoded revert reason in plain words). Every failure message states explicitly whether anything was broadcast.

## 6. Mini App platform integration

**Today:** Telegram WebApp APIs exist in type defs and `ErrorBoundary` only. Pages use a custom `<ArrowLeft>` back button, fixed gray/dark Tailwind palette, browser `history.back()`, no MainButton, no haptics, no `viewportStableHeight` — it feels like a website in an iframe, which is exactly what Telegram's design guidelines penalize.

**Required (mechanical, low-risk wins):**
- `BackButton.show()/onClick` per route; delete custom back buttons.
- `MainButton` as the single confirm CTA ("Open Long 3x — 1.0 ETH"), with progress state during simulation/signing.
- `HapticFeedback.notificationOccurred('success'|'error')` on outcome.
- Map `themeParams` → CSS variables (one provider component); respect `colorScheme` instead of `dark:` media classes.
- `viewportStableHeight` for layout; `expand()` on mount.
- TTI budget: static export is the right call; audit bundle (Privy SDK is heavy — lazy-load it behind the auth gate) to meet the <2.5s 3G-Fast SLO in METRICS.md.

## 7. i18n

**Today:** 14 locale JSONs across two duplicate directories (`apps/bot/locales/`, `apps/bot/src/i18n/locales/`), `@grammyjs/i18n` wired nowhere, 100% hardcoded English strings, `User.language` column unused.

**Required:** pick one locale dir, wire `@grammyjs/i18n` middleware keyed off `User.language` → `ctx.from.language_code` fallback; move command strings into the catalogs; CI check for missing keys. (Competitors are mostly English-only — shipping real i18n is a differentiator, but only after the English flows actually work.)

## 8. Notifications & retention

**Today:** `NotificationPref` schema (quiet hours, per-type toggles) is genuinely well-designed — and entirely unused; every send is commented out.

**The bar:** fill/confirmation pushes within seconds; liquidation warnings are *the* retention feature for leverage products.

**Required:** wire tx-notifier + health-monitor sends through one `notify(userId, type, payload)` gate that enforces prefs/quiet hours (bypass for URGENT health, as designed); deep-link every notification back to the relevant command/mini-app view.

---

## Priority order (UX work only, after P0 safety items)

1. Onboarding: wallet creation end-to-end (nothing else matters until this works)
2. /trade with real quote + inline keyboard + Mini App MainButton confirm
3. Position display from chain + close flow
4. Notifications (fills + health warnings)
5. /limit signing done right
6. Theme/haptics/BackButton polish
7. i18n wiring
