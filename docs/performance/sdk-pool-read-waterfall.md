# SDK pool-read waterfall

## Change and boundary

The reviewed SDK patch starts only `Pool.getPoolData`,
`Price.getRateRes`, and `Price.getOraclePrice` concurrently. These are view
reads. It immediately observes each promise's success or rejection, then
consumes outcomes in the original pool/rate/oracle order. The first relevant
failure retains its original reason and does not wait for later hanging reads.

`getBuyPrice` still starts only after all three view results succeed.
`getSellPrice` still starts only after the buy quote succeeds. The quote calls,
Decimal arithmetic, raw fee tuples, return shape, validation, approvals,
nonces, and transaction construction are unchanged.

This distinction matters: the SDK's `queryConvert` ABI is **nonpayable**.
Starting all five reads together would let viem put formerly separate
converter calls in one `aggregate3` execution context. That exploratory
variant was discarded; its approximately 400 ms synthetic savings are not
results for this change.

## Reproducible measurement

Run after the pinned dependencies and SDK patch are installed:

```sh
node scripts/measure_sdk_pool_reads.cjs
node --import ./apps/mini-app/node_modules/tsx/dist/loader.mjs --test apps/mini-app/test/sdk-pool-read-concurrency.test.ts
```

The benchmark runs the actual installed CommonJS SDK and its own viem
transport/batching implementation behind a local fake provider. It never
contacts a provider or submits a transaction. Every `eth_call` receives a
fixed 100 ms delay; nonce reads are immediate deterministic fixtures.

The comparison restores the old three serial reads in an **in-memory** copy.
The terminal 500 ms multicall sleep is removed in **both** in-memory variants,
so these are incremental savings beyond the multicall pacing change. The runs
were recorded against an earlier build of the patch; rerunning the script
prints the installed bundle's hash.

Medians of three runs per case on 7 October 2026, Node 22.23.3:

| Actual SDK path | Serial | Concurrent view reads | Saved |
| --- | ---: | ---: | ---: |
| ETH long pool stage | 534 ms | 332 ms | 202 ms |
| BTC long pool stage | 543 ms | 344 ms | 199 ms |
| ETH short pool stage | 535 ms | 327 ms | 208 ms |
| BTC short pool stage | 539 ms | 336 ms | 203 ms |
| Complete ETH `depositAndMint` plan | 634 ms | 427 ms | 207 ms |
| Complete BTC `depositAndMint` plan | 640 ms | 444 ms | 196 ms |

Raw run conditions, all samples and request groupings are preserved in
[`sdk-pool-read-benchmark.json`](sdk-pool-read-benchmark.json).

Both variants produced these identical complete Borrow plan hashes on every
repeat (SHA-256 of recursively key-sorted JSON, with bigint values tagged as
`{"bigint":"decimal"}`):

- ETH: `0560a95290cd59f84d00987d4e2b83e68e27b0262368766b2bdf70b2d71fbfc5`
- BTC: `da645a901d73bae812017b996e2d228e6cbcb15a16e7ee5132ed19ede13daade`

The complete ETH plan made ten logical contract reads; the BTC plan made
twelve. Their `eth_call` request counts changed from six to five. Each also
made its unchanged, immediate fixture nonce read.

These are synthetic network conditions, not live-provider or user-journey
measurements. Scheduler/encoding overhead varies. The structural saving is
**two RPC-depth stages**, approximately 200 ms at the chosen 100 ms RTT.

The shared pool stage changes from five serial `eth_call` requests to four
requests across three stages:

1. Pool multicall and rate/oracle multicall concurrently
2. Buy quote in its own existing multicall
3. Sell quote in its own existing multicall

Logical contract reads remain nine for ETH pools and eleven for BTC pools.
The benchmark asserts identical logical target/method/arguments, identical
converter batch grouping, no converter/view-read coalescing, and deeply equal
complete outputs. The Borrow comparison includes final calldata, values,
nonces, metadata, and protocol fee information. No planner algorithm is
reimplemented in the benchmark.

## Regression evidence

The installed ESM and CommonJS bundles are both executed by the regression
suite. Fourteen tests cover:

- Three view reads start before any resolves; out-of-order completions retain
  their correct mapping; all five reads occur exactly once on success
- No quote until all views succeed, and no sell quote until buy completes
- 256 exact pool-result fixtures across both sides, large integer values,
  retained metadata, fee tuples, and unchanged global Decimal precision
- Every individual read failure, AbortError propagation, simultaneous failures
  with original error precedence, and late sibling rejections without
  unhandled-rejection leakage
- An early pool error returns even while rate and oracle promises remain pending
- Advancing-block fixtures issue fresh reads on every invocation and retain
  later, ordered buy/sell snapshots
- 96 fail-closed paths through the actual five public SDK planner entry points
  across their applicable ETH/BTC long/short combinations and both bundles

The original installed SDK fails the concurrency assertion because only its
pool read starts. The patched isolated installation passes all fourteen tests.
Focused ESLint also passes for the regression file and benchmark source.

Public-planner failure coverage stops before transaction construction. Complete
success-plan equivalence is measured for the two `depositAndMint` cases above;
this report does not claim full success-plan equivalence coverage for every
leveraged increase/reduce/adjust path or a live-chain simulation.

## State, failures, and residual risks

- All five position planners call this shared pool stage once. Position-list
  hydration also calls it when the SDK finds positions. Earn and Bridge do not
  use this stage and should not be assigned its savings.
- The methods use the same SDK `getClient` singleton, configured by the app
  with its existing chain-bound transport. No endpoint identity check,
  fallback/revert policy, route validation, or receipt gate was removed.
- The rate and oracle views may now observe an earlier latest block than the
  serial implementation and can share a block with each other. Neither
  implementation guarantees one atomic block snapshot. The advancing-block
  fixture proves fresh reads and ordering, not cross-block financial
  equivalence. Existing fresh review and per-signature simulation remain
  necessary and unchanged; this patch cannot authorize using old quotes.
- Initial request concurrency rises from one to two provider calls, while the
  successful total decreases by one. On early pool failure the two other view
  reads have already started. Their errors are observed and existing transport
  deadlines still bound them; the patch does not add sibling cancellation or
  claim that an in-flight provider request is stopped.
- No persistent cache, TTL extension, new SDK method, changed precision,
  transaction submission, or wallet approval is introduced.
