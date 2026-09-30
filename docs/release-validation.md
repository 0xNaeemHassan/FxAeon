# Release validation record

## Current candidate

- Pull request: [#208](https://github.com/0xNaeemHassan/FxAeon/pull/208)
- Current candidate commit: `dad36853a3616c6666534dfc39c00647b6b1d9e3`; all
  four GitHub checks passed. Client CI reported 496 unit tests passed (4
  skipped), 165 main-browser tests, 6 Borrow tests, 25 overlay tests, 5
  state-lab tests, and 14 landing states. The log contained no Playwright retry
  markers. This is not release approval.
- The `anvil-all` suite completed successfully with 4/4 protocol, Earn, and
  stress tests, and its manifests were verified. The log is
  `artifacts/refinement/anvil-all-20260929.log`.
- The previous fork-browser run on `337fd1e` opened all four position types,
  then failed on a stale Close button locator. The corrected `dad3685` Anvil
  run reached the close review, then failed because its CTA was hidden under
  the bottom navigation. An uncommitted follow-up batch is being focused-tested;
  full gates have not been rerun. No release pass or merge is claimed.
- Visual review of all 101 frames in
  `artifacts/refinement/generated/run-20260930T015019Z/` is complete. Public
  documentation omits private addresses and secrets.
- The refinement includes ordered gas estimation, full ordered route
  simulation, compact approval presentation, and pastel code-native landing
  illustrations. Unit and main-browser CI gates passed on `dad3685`; its
  fork-browser proof remains pending.

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
`artifacts/refinement/generated/run-20260930T015019Z/` contains 64 views and
101 frames captured from the local production-placeholder
export. The capture reported no page or console errors. Its connected
test-wallet shim, read-only illustrative balances, and ready-empty positions
document rendered UI only; the displayed APY uses a public feed, while Trade's
24-hour change remains a skeleton because the fixture has no Coinbase ticker
value. These images do not establish live
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
