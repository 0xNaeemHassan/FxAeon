# Release validation record

## Current candidate

- Pull request: [#208](https://github.com/0xNaeemHassan/FxAeon/pull/208)
- Repository HEAD at this update: `794f965`, with uncommitted refinement changes
  in the shared working tree. This is an in-progress candidate, not a release
  approval.
- The `anvil-all` suite completed successfully with 4/4 protocol, Earn, and
  stress tests, and its manifests were verified. The log is
  [`artifacts/refinement/anvil-all-20260929.log`](../artifacts/refinement/anvil-all-20260929.log).
- The serial verification attempt recorded in
  [`artifacts/refinement/verify-20260929-serial.log`](../artifacts/refinement/verify-20260929-serial.log)
  passed its build and unit checks but had 18 browser failures involving test
  mocks and disclosure expectations. Those issues were corrected; the
  corrective browser run passed 26/26 in
  [`artifacts/refinement/browser-corrective-20260930.log`](../artifacts/refinement/browser-corrective-20260930.log).
- Full `pnpm verify` completed successfully (exit 0) in
  [`artifacts/refinement/verify-20260930.log`](../artifacts/refinement/verify-20260930.log).
  It recorded 495 unit tests passed and 4 fork-dependent skips, completed the
  production build, passed 165 production browser tests, 6 Borrow harness
  tests, 24 overlay tests, 5 state-lab tests, and all 14 landing-browser states.
- The refreshed screenshot gallery completed with 64 views and 101 frames in
  [`artifacts/refinement/generated/run-20260930T015019Z/`](../artifacts/refinement/generated/run-20260930T015019Z/).
  The fork-browser rerun is still running; release readiness, current-head CI,
  visual review, and fork-browser proof remain pending. Public documentation
  omits private addresses and secrets.
- The refinement includes ordered gas estimation, full ordered route
  simulation, compact approval presentation, and pastel code-native landing
  illustrations. Validation of these changes remains in progress.

Gas speed is now a saved device preference with Standard, Fast, and Rapid
choices. Changing the tier while a review is open invalidates that review and
requires an explicit updated review. The selected tier is bound to each wallet
request; the fork browser gate checks its EIP-1559 fee fields against the exact
fee-history snapshot captured for the review. Tier quotes expire after 30
seconds. The legacy single-price oracle fallback may accept snapshots up to five
minutes old; that fallback freshness is separate from the transaction-tier
quote lifetime. Display-only prices remain valid for up to one hour with their
original timestamps preserved.

The UI also includes a borderless Portfolio and Wallet hierarchy, an asset
ledger, an authenticated header, and Settings invalidation for saved transaction
preferences. The landing page is Telegram-first and uses official product marks
with an illustrative preview.

A user-authenticated check on local build `0c418ad` completed healthy live
balance and network reads, showed four assets and healthy ETH/BTC mini charts,
and showed the matching opening and closed History events with no open
positions. This earlier runtime spot-check is not a release gate for the current
candidate. Private balances, wallet identity, and screenshots are omitted.

## Visual evidence

The current gallery at
[`artifacts/refinement/generated/run-20260930T015019Z/`](../artifacts/refinement/generated/run-20260930T015019Z/)
contains 64 views and 101 frames captured from the local production export.
The capture reported no page or console errors. Its connected test-wallet
shim, read-only illustrative balances, ready-empty positions, and deterministic
market data document rendered UI only; they do not establish live balances,
transaction behavior, or production performance. Final screenshot promotion
remains pending the fork-browser rerun.

The Cloudflare preview lacks RPC environment values. The earlier authenticated
local spot-check confirmed healthy reads, but not transaction submission or
production behavior. The gallery is local visual evidence and does not establish
live RPC health or production performance.

## Release workflow boundaries

Pushing to `main` starts the production Pages workflow. It syncs the gas-oracle
secret, validates production configuration, runs verification and build,
deploys to Cloudflare Pages, performs live wallet/gas checks, and syncs Telegram
bot metadata and menu. A `v*` tag separately publishes a GitHub Release after
verification; it does not deploy Pages. The manual Anvil workflow uses a
disposable Ethereum fork. Production deployment, release publishing, and
post-merge validation remain pending.

See [testing](testing.md), [browser test gates](browser-test-gates.md), and
[visual review](review/README.md) for suite scope and screenshot provenance.
Native Telegram wallet handoff and real cross-chain delivery are outside the
local Ethereum fork proof.
