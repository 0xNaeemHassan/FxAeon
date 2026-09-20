# FxAeon implementation progress

This page describes the current checkout as of 20 September 2026. It records
available evidence and open verification work; it is not a release sign-off.

## Current product shape

- `apps/mini-app` is the financial web and Telegram Mini App. Its public app
  entry is `fxaeon.com/`; `/portfolio` remains a compatibility alias.
- `apps/landing` is the independent marketing site for `fxaeon.xyz`. It has no
  wallet, Privy, protocol, or transaction authority.
- Positions, Borrow, and fxSAVE use Ethereum as their source of truth. Move
  supports the documented Ethereum/Base bridge routes.
- Position cards show current USD position value, not P&L or ROI. The pinned SDK
  and canonical reader do not supply complete entry/cost basis; no profit/loss
  color is inferred from the current value. Long/Short color remains directional.
- Portfolio shows a known USD subtotal when reads or prices are incomplete and
  a full total only when valuation is complete. Unknown values stay distinct
  from confirmed zero; stale values are excluded, and refresh remains an
  explicit compact control.
- The browser receives public configuration only. Wallets remain the signing
  boundary; no private key or server signer belongs in the app.

## Evidence available now

### Protected protocol and fxSAVE fork gates

The final all-suite Anvil run exited successfully in
`%TEMP%/fxaeon-final-all-fork.log`: `4/4` tests passed, with no failures or
skips, in `280.6` seconds. This covered the four-position protocol proof, the
fxSAVE Earn lifecycle, and both stress campaigns. The validated manifests are
`artifacts/anvil/protocol-all-proof.json` and `artifacts/anvil/earn-proof.json`.

The separate hydrated browser-fork gate also passed on retry. Its final proof
is recorded below.

### Protected browser-fork lifecycle

The final browser proof is recorded in `artifacts/anvil/browser-proof.json` at
Ethereum fork block `25965421`. The successful retry completed four position
opens and closes, SDK discovery and ownership-transfer/account isolation,
index-lag recovery and balance refresh, borrowing against the existing ETH
long, one-block receipt handling, and the supported viewport checks. It restored
the fork snapshot. The run log is
`%TEMP%/fxaeon-final-browser-fork-retry.log`.

This proves the named funded fork lifecycle. It does not prove native Privy,
Telegram, device-specific wallet behavior, or bridge destination delivery.

### Standard UI documentation captures

The nine standard screenshots in `docs/assets/` were refreshed on 20 September
2026 at `2026-09-20T05:56:32Z`, using a fresh page and browser context for each
view and live external display data. The manifest
`docs/fixtures/standard-screenshot-manifest.json` records the routes, viewports,
hashes, and zero page, console, fallback, or discovery errors. No wallet
transaction was submitted. These screenshots document rendered UI states and
are separate from the fork-backed position evidence below.

### Position documentation capture

The promoted four-image capture is recorded in
`docs/fixtures/position-screenshot-manifest.json` with
`executionSurface: browser`, fork block `25965421`, no discovery errors, and
visibly labelled illustrative display prices/charts. The four app screenshots
and desktop/mobile landing aliases are hash-validated against that manifest.
The images show fork state, not production balances or real market prices. The
landing's connected-position aliases are separate, current fork captures.

### Configured Privy theme hydration

The strengthened check passed on a configured development build at
`localhost:4321`: `/`, `/trade`, and `/positions` rendered with the saved light
preference, then remained stable for three seconds after the visible Connect
wallet control appeared. There were no hydration warnings or page errors; the
Trade token picker also opened. With Privy configured, server rendering can
show the existing “Loading FxAeon” shell until the provider chunk mounts; this
is a provider-loading state, not an authentication gate. This verifies the
configured app shell and theme only. No Privy sign-in, email, Telegram
handoff, or wallet transaction was attempted.

### Source and test status

The focused Portfolio asset-summary tests pass `14/14`, covering partial
subtotals, stale-value exclusion, pending reads, unknown values, and confirmed
zero. Portfolio typecheck passes after the supported-value card prop-shape fix.

Final verification passed on PR `#193` head
`064229b6fb6640f9d16087ab48da13e85b05f356`: all six CI checks passed, including
Client CI's full `pnpm verify` with exit code `0` and built-browser E2E. After
test-only hardening of stale-preview scheduling, focused checks passed `3/3`
and the complete browser suite passed `109/109` in 5.8 minutes; see
`%TEMP%/fxaeon-final-109-e2e-identity.log`. Full and production dependency
audits report zero known vulnerabilities. Two pre-existing high-severity
development-dependency findings were resolved by updating `js-yaml` to `4.3.2`
and Miniflare's nested `sharp` to `0.35.4`. Final lint passed with zero warnings.

The protocol, Earn, stress, and browser-fork proofs are separately recorded
above. The landing's final full-hero wash and card direction passed visual
review; 14 theme/width states retained the same contrast minima.

## Remaining verification gaps

- Verify native Privy sign-in, Telegram seamless login and handoff, injected
  wallet confirmation, keyboard/device behavior, and bridge destination
  delivery in their supported hosts.

See [`testing.md`](testing.md) for commands and evidence boundaries and
[`position-screenshot-fixture.md`](position-screenshot-fixture.md) for the
fork-backed capture procedure.
