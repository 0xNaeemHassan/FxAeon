# Release validation record

## Current candidate

- Pull request: [#208](https://github.com/0xNaeemHassan/FxAeon/pull/208)
- Candidate commit: `3663bdc60f15aa1788df7ed68ef2b3027f5e7a8b`.
- Final `pnpm verify` is running. Focused fee-tier tests passed 60/60, and
  TypeScript and lint checks passed; final verification, build, and current-head
  CI are not yet recorded as complete.
- The protected protocol suite last passed 4/4 at pinned fork block `26065969`.
  The new fee-tier wallet-request assertions still need the fork browser rerun.
- The latest fork browser attempt stopped before signing because transaction
  simulation was unavailable. Its retry was stopped during warmup for edits;
  there is no active fork run and no browser pass is claimed.
- History previously verified matching receipt/router-bound opening and closing
  events. Public documentation contains no wallet or transaction identifiers.

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

The fixture gallery at
[`artifacts/refinement/generated/run-20260927T154147Z/`](../artifacts/refinement/generated/run-20260927T154147Z/)
contains 66 views and 101 frames from build `34400ef`. It predates the current
fee-tier changes and needs refresh. Its connected test-wallet shim and market
fixtures document rendered UI only; they do not establish live balances or
transaction behavior. Final screenshot promotion remains pending the browser
proof.

The Cloudflare preview lacks RPC environment values. The earlier authenticated
local spot-check confirmed healthy reads, but not transaction submission or
production behavior.

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
