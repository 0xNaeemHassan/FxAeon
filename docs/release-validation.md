# Release validation record

Results apply only to the source revision and evidence listed here. A
successful typecheck alone is not a release result.

## Last fully validated revision and current follow-up

- Pull request: [#208](https://github.com/0xNaeemHassan/FxAeon/pull/208)
- Last fully validated pushed source: `87f51734875098e60b868076661dba6206b189cd`
- Validation date: 2026-09-27
- `pnpm verify`: passed with terminal exit code 0; log: `%TEMP%/fxaeon-release-verify.log`
- `pnpm test:anvil:all`: passed with terminal exit code 0 (4/4); log: `%TEMP%/fxaeon-release-anvil-all.log`; pinned fork block `26065969`
- Protected Anvil browser proof: first attempt failed; no pass is claimed
- Fresh visual gallery review: complete for the capture listed below; no material clipping found
- GitHub CI for `87f5173`: all four workflows passed: [Client CI](https://github.com/0xNaeemHassan/FxAeon/actions/runs/36302840079), [Mini App E2E](https://github.com/0xNaeemHassan/FxAeon/actions/runs/36302840101), [Secret Scan](https://github.com/0xNaeemHassan/FxAeon/actions/runs/36302840102), and [Supply Chain](https://github.com/0xNaeemHassan/FxAeon/actions/runs/36302840099)

The first browser-proof attempt opened all four ETH/BTC long/short positions,
then failed when the existing-position Borrow review CTA did not fit at
393×852. The product navigation and outcome-summary layout are being corrected;
the browser proof must be rerun. The current working-tree correction is not
covered by the verification, Anvil, or CI results listed for `87f5173`.

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

The protected protocol proof is complete and separate from the `pnpm verify`
gate. All four real partial reductions passed at pinned fork block `26065969`.
The first protected browser proof attempt failed at the Borrow review action
fit check described above; a rerun is required after the corrective UI change.
All four GitHub workflows passed for `87f5173`, before that follow-up change.
The four fork-related skips in the unit/contract suite are not a substitute
for these dedicated release proofs.

The validated source includes product and landing changes, shared portfolio
asset-state coverage, synchronous wallet-refresh failure/retry coverage, route
metadata and enlarged-text checks, and the Anvil proof updates.

## Coverage in the candidate

- The isolated PortfolioAssets browser harness distinguishes pending, ready
  empty, unavailable with Retry, and verified holdings during refresh.
- The refresh harness covers fan-out/coalescing, wallet changes with stale
  requests, and a synchronous reader failure followed by a same-wallet retry.
- Production browser checks cover route-specific metadata before hydration,
  responsive review-action clearance at 393×852, 44px amount shortcuts, and
  form reachability with 200% text in Official, Dark, and Light themes.
- The completed protocol proof exercised four real 25% reductions: ETH long,
  ETH short, BTC long, and BTC short. It verified position ownership/identity,
  changed only the selected position, returned the selected output, and
  reverted the fork snapshot. See the redacted
  [protocol proof](../artifacts/anvil/protocol-proof.json).
- The completed fxSAVE proof verified a deposit, instant withdrawal, queued
  withdrawal, one-hour cooldown, and claim, along with the direct base-pool
  deposit/redeem checks, balances, shares, events, and fees; it reverted the
  fork snapshot. See the redacted
  [fxSAVE proof](../artifacts/anvil/earn-proof.json).
- The browser proof is not complete: its first attempt opened all four
  ETH/BTC long/short positions but failed the 393×852 existing-position Borrow
  review CTA fit assertion. The UI correction and rerun are pending. The proof
  also checks expired-quote refresh without signing and binds reviewed
  transactions to broadcast calldata.

See [testing](testing.md) and [browser test gates](browser-test-gates.md) for
the suite boundaries and remaining release gates.

## Visual evidence

The reviewed current-working-tree gallery is
[`artifacts/refinement/generated/run-20260927T071112Z/`](../artifacts/refinement/generated/run-20260927T071112Z/).
It contains 63 views and 103 PNG frames at 393×852 mobile and 1440×1000 desktop
viewports. Root and the form-art reviewer inspected the Portfolio, wallet
profile, main forms, Settings, More, Receive, History, and every Docs section;
they found no material clipping in those captured views. The subsequent
protected browser attempt exposed a separate 393×852 fit failure in the
existing-position Borrow review CTA; this gallery does not clear that gate.

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
