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

### Position documentation capture

The promoted four-image capture is recorded in
`docs/fixtures/position-screenshot-manifest.json` with
`executionSurface: browser`, fork block `25965421`, no discovery errors, and
visibly labelled illustrative display prices/charts. The four app screenshots
and desktop/mobile landing aliases are hash-validated against that manifest.
The images show fork state, not production balances or real market prices. The
remaining standard UI captures predate the current domain split and are not
current visual release evidence. The latest standard recapture was not
promoted: five views were saved before Portfolio's two-sparkline readiness
check timed out on a reused page. A fresh isolated page displayed both charts
without runtime errors. Existing standard images and their manifest remain
unchanged; the landing's connected-position aliases are separate, current fork
captures.

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

Final verification completed across the aggregate run and a separate browser
rerun. `%TEMP%/fxaeon-final-release-verify-latest.log` records `380` source/unit
checks (`376` passed, `4` skipped) and passing build/export, typecheck, bundle,
frontend-secret scan, audit, and landing checks (eight static plus 14
theme/viewport states). Its initial browser stage reached `108/109` and exited
`1`. After test-only hardening of stale-preview test scheduling, the focused
harness passed `3/3` across two workers and the complete built-browser suite
passed `109/109` in 5.8 minutes; see
`%TEMP%/fxaeon-final-109-e2e-identity.log`. Final lint passed with zero
warnings. These are results across separate runs, not one aggregate command
with exit code `0`.

The protocol, Earn, stress, and browser-fork proofs are separately recorded
above. The landing's final full-hero wash and card direction passed visual
review; 14 theme/width states retained the same contrast minima. The standard
nine-view screenshot refresh remains incomplete; see the recapture note above.
The landing's connected-position aliases are separately current.

## Remaining verification gaps

- Verify native Privy sign-in, Telegram seamless login and handoff, injected
  wallet confirmation, keyboard/device behavior, and bridge destination
  delivery in their supported hosts.
- Complete and review the standard UI screenshot refresh before publication.
  The promoted landing position captures are already tied to their manifest and
  illustrative market-data mode.

See [`testing.md`](testing.md) for commands and evidence boundaries and
[`position-screenshot-fixture.md`](position-screenshot-fixture.md) for the
fork-backed capture procedure.
