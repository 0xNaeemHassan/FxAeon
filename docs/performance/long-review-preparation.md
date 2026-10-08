# Long review: immediate presentation and checked terms

## What changes

Trade opens one review card immediately when Review is clicked. Entered facts
occupy their usual rows while unknown route and fee values are checked; the
action stays disabled. Once a verified route exists, its facts replace the
entered values and remain bound to that route during signing, even if the live
form or wallet changes. Missing verified facts never fall back to live inputs.
The card fits its content within the available viewport, without a fixed-height
canvas or a permanent three-line status gap.

A click also prevents a not-yet-started advisory warm-up from launching another
full SDK plan. This covers both the 220 ms timer and its asynchronous block read.
Already-started exact-input prefetches remain reusable through their existing
10-second TTL, wallet/session/input key, current-block recheck, policy validation,
and ordered simulation. Edit, cancellation, changed inputs and changed wallets
retain their existing invalidation behavior.

Confirm remains disabled while the route-specific fee check is pending, including
when a still-fresh cached estimate exists during a background refresh. Shared
requests remain coalesced across hook cancellation and re-enabling. A settled
partial or unavailable estimate retains the existing execution-time fallback;
the runner still performs its authoritative policy, simulation and funding checks
before requesting any signature. No gas margin, fee cap or freshness period is
reduced.

Fresh preparation clears previous expiry, quote-change and fee-tier data. A
planner that clamps its own input and rejects retains its actionable error;
Retry performs fresh checks and moves keyboard focus to the review heading.
The card exposes preparation as busy. Background fee refresh still blocks
confirmation but does not repeatedly announce loading placeholders.

## Historical controlled full-path evidence

The figures below are historical measurements of the original #253 draft and
its combination with this change. They predate the SDK pacing correction and
are obsolete as evidence for the current combined branch. The earlier draft
changed request pacing; measurements must be rerun with the corrected pacing.
No current live speed improvement is established by this report.

The browser fixture compiles the real Trade and ActionReview components, service
adapter, patched SDK, route policy, ordered simulation and gas-cost hook. Wallet,
balance/position display providers, chart and transport responses are fixtures.
It never connects or signs with a wallet and never calls a live provider.

Measured on 7 October 2026 with 100 ms per mocked RPC, a successful 100 ms gas
oracle, Chromium 153, no CPU/network throttling, and a settled initial form.
The ETH sample is a small native-input Long at 2.8x, with 0.5% slippage. The
BTC comparison uses 0.001 WBTC at 2.8x. Checked-in regression fixtures use
round synthetic account values. These were single illustrative samples, not
production latency guarantees or aggregate browser startup measurements.

| Scenario | Full SDK plans | Verified review rendered | Fee check settled |
| --- | ---: | ---: | ---: |
| Main 4a1f44c, ETH quick click | 2 | 4,290 ms | 4,511 ms |
| Draft #253 at 65842bd, ETH quick click | 2 | 2,550 ms | 2,768 ms |
| Historical combined draft, ETH quick click | 1 | approximately 2,570 ms | 2,787 ms |
| Historical combined draft, ETH warmed before click | 1 before click | 262 ms | 483 ms |
| Historical combined draft, BTC quick click | 1 | 5,339 ms | 5,557 ms |

The immediate user-input preview DOM rendered in approximately 20–40 ms in
these historical samples. This is not a production-shell pixel-paint measurement.
It is a distinct milestone from verified review and from the later fee check.
The deliberately insufficient ETH fixture did not present an enabled Confirm.

For the historical quick-click ETH comparison with #253, total fixture contract
reads fell from 426 to 214 and transport RPCs from 163 to 85. Exact transaction
bytes were identical. On an uncongested fixture, removing duplicate work did not
establish an additional cold-latency improvement beyond #253. Provider contention
and rate limiting were not modeled.

The historical SDK-only fixture sampled 100 conversion quotes per borrow-sizing
round with 500 ms inter-chunk pacing. For this ETH input, the original #253 draft
took 2,142 ms in the SDK, including 1,000 ms of pacing. The BTC comparison took
4,878 ms, including 3,000 ms of pacing across its two sizing searches. These
timings predate the pacing correction and do not describe the current SDK patch.

## Regression coverage

Run the ordinary source tests and these browser tests with the repository's
supported Playwright browser:

```sh
pnpm --dir apps/mini-app test
pnpm --dir apps/mini-app exec playwright test \
  --config e2e/trade-harness.config.ts \
  review-preparation gas-check-pending
pnpm --dir apps/mini-app exec playwright test action-review-harness.spec.ts
```

The browser suite covers quick clicks, click during the advisory block read,
in-flight/completed warm reuse, changed-block rejection, Edit, wallet changes,
initial fee loading, current-cache refresh, cancellation/re-enable, shared
request coalescing, StrictMode and settled unavailable estimates. The RPC
fixture executes the real SDK and viem batching; it accepts only read methods.
Stable-Trade orchestration regressions additionally cover input and wallet
changes during pending signing, missing verified fields, stale metadata after
a new attempt, initial and refresh clamp failures, keyboard Retry, busy state,
quiet background refresh, and changed-input rejection during preparation.
Responsive tests cover 320, 393, 768 and 1100 px widths with reduced motion,
retained card/field nodes, content fitting, and an action target of at least 44 px.
The shared-cache unit regression verifies that pending transport work remains
observable without mislabeling a fresh cached estimate as expired.

The historical main/#253 SDK comparison also covered all eight combinations of
ETH or BTC, new or existing position, and token/position approval needed or already
present. Complete plans and approval/nonce order were unchanged. Those existing-
position checks are SDK fixtures, not full position-management UI journeys.

## Limits

Balances and displayed positions are preloaded fixtures, so cold authenticated
account hydration, Privy initialization, native Telegram, live RPC limits and
real-wallet journeys are not established here. Full production export and final
combined-draft checks must be reported separately. No merge or deployment is
part of this change. Same-block prefetch can still miss after a block advances,
and the full fresh plan remains necessary in that case. Immediate presentation
must not be described as instantaneous RPC or transaction readiness.
