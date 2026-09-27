# Release validation record

Results apply only to the working-tree state and evidence listed here. Refresh
this record after final verification; a successful typecheck alone is not a
release result.

## Current candidate

- Pull request: [#208](https://github.com/0xNaeemHassan/FxAeon/pull/208)
- Verified source basis: working tree based on `7c7157023adbea8eaf3b57612e4265dc57eba73d`; changes were uncommitted during verification, so this is not commit evidence
- Validation date: 2026-09-27
- `pnpm verify`: passed with terminal exit code 0; log: `%TEMP%/fxaeon-release-verify.log`
- Protected Anvil protocol proof: running locally at fork block `26065969`; browser proof: pending
- Fresh visual gallery review: complete for the capture listed below; no material clipping found
- CI for the final committed revision: pending

The successful verification run covered the uncommitted working-tree state
based on `7c71570`. It must not be attributed to a later commit until the
committed revision has its own successful CI and protected protocol/browser
proofs.

## Verification evidence

- Unit and contract tests: 466 passed, 0 failed, 4 fork-related skips.
- Root `pnpm verify` typecheck gate ran both `pnpm --dir apps/mini-app typecheck`
  and `tsc -p apps/mini-app/e2e/fork/tsconfig.json`.
- Built Mini App browser suite: 163 passed.
- Borrow harness: 5 passed; overlay harness: 18 passed; state lab: 5 passed.
- Landing build and static checks completed. The landing browser verifier passed
  14 theme/viewport states covering preview semantics and readability, visible
  content bounds, WCAG text contrast, 44px targets, keyboard/theme persistence,
  reduced motion, and zero external requests.

Anvil protocol and browser proofs are separate from the successful `pnpm
verify` gate. The local protocol run is in progress at fork block `26065969`;
the browser proof remains pending. The four skipped tests are not a substitute
for those release proofs. CI for the final committed revision remains pending.

The verified working tree includes product and landing changes, shared
portfolio asset-state coverage, synchronous wallet-refresh failure/retry
coverage, route metadata and enlarged-text checks, and Anvil proof updates.
Earlier successful results apply to revision
`7c7157023adbea8eaf3b57612e4265dc57eba73d` only and do not establish the
current working-tree or future committed-revision gates.

## Coverage in the candidate

- The isolated PortfolioAssets browser harness distinguishes pending, ready
  empty, unavailable with Retry, and verified holdings during refresh.
- The refresh harness covers fan-out/coalescing, wallet changes with stale
  requests, and a synchronous reader failure followed by a same-wallet retry.
- Production browser checks cover route-specific metadata before hydration,
  responsive review-action clearance at 393×852, 44px amount shortcuts, and
  form reachability with 200% text in Official, Dark, and Light themes.
- The protected protocol proof opens ETH/BTC long/short positions and performs
  a real 25% partial reduction using market- and side-specific SDK amount
  units. The browser proof checks expired-quote refresh without signing and
  binds reviewed transactions to broadcast calldata. Earn browser coverage
  verifies deposit calldata and reviews both instant and queued withdrawals.

These describe assertions in the current source; they do not imply that the
pending candidate gates have passed. See [testing](testing.md) and [browser
test gates](browser-test-gates.md) for the suite boundaries.

## Visual evidence

The reviewed current-working-tree gallery is
[`artifacts/refinement/generated/run-20260927T071112Z/`](../artifacts/refinement/generated/run-20260927T071112Z/).
It contains 63 views and 103 PNG frames at 393×852 mobile and 1440×1000 desktop
viewports. Root and the form-art reviewer inspected the Portfolio, wallet
profile, main forms, Settings, More, Receive, History, and every Docs section;
they found no material clipping.

The capture manifest records zero page errors and zero console errors. It also
records two `net::ERR_ABORTED` requests for same-origin Next RSC prefetches
during navigation (`settings` and `more`), not external-service failures. The
gallery uses a connected test-wallet shim and deterministic illustrative
market data; wallet balances and flow-specific route quotes are unavailable,
and no confirmation, signature, transaction, or chain mutation was performed.
It documents rendered UI only, not healthy live data or protocol state.

The earlier gallery at
[`artifacts/refinement/generated/run-20260927T025408Z/`](../artifacts/refinement/generated/run-20260927T025408Z/)
is historical and is not the current visual evidence.

Concept art in `artifacts/refinement/concepts/` is not implementation evidence.

## Release limits

Browser emulation does not establish native Telegram authentication, wallet
handoff, or real bridge delivery. Record those separately if exercised. Do not
infer them from the automated browser or fork results.
