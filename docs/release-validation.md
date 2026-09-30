# Release validation record

## Current candidate

- Pull request: [#208](https://github.com/0xNaeemHassan/FxAeon/pull/208)
- Candidate commit: `624f725`. All four GitHub checks passed for this commit.
  This is not a release approval.
- The `anvil-all` suite completed successfully with 4/4 protocol, Earn, and
  stress tests, and its manifests were verified. The log is
  [`artifacts/refinement/anvil-all-20260929.log`](../artifacts/refinement/anvil-all-20260929.log).
- The 2026-09-30 Anvil browser run failed because the fee estimate disappeared
  after the quote-expiry probe. The cache had captured the original `Date.now`
  function before the browser's fake clock was installed, causing repeated
  gas-estimate refreshes. `gasCost.ts` now uses a live `() => Date.now()`
  default, and its focused gas tests pass 18/18.
- Full `pnpm verify` is rerunning in
  [`artifacts/refinement/verify-clock-20260930.log`](../artifacts/refinement/verify-clock-20260930.log).
  The Anvil browser proof will rerun after verification. Neither a release pass
  nor a merge is claimed.
- Visual review of all 101 frames in
  [`artifacts/refinement/generated/run-20260930T015019Z/`](../artifacts/refinement/generated/run-20260930T015019Z/)
  is complete. Public documentation omits private addresses and secrets.
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
contains 64 views and 101 frames captured from the local production-placeholder
export. The capture reported no page or console errors. Its connected
test-wallet shim, read-only illustrative balances, ready-empty positions, and
deterministic market data document rendered UI only; they do not establish live
balances, transaction behavior, or production performance. Visual review is
complete; earlier images remain historical until the current fork-browser
proof is complete.

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
