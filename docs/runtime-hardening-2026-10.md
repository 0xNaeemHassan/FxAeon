# Runtime hardening changes — 3 October 2026

This note describes the current working-tree changes and their validation status. It is not a release sign-off. Source checks, production build, all 193 main browser cases, 56 isolated browser cases, and 14 landing states passed. Full typechecking passed after removing temporary fork-replay setup. The Anvil protocol and fxSAVE all-suite run passed; the fork browser replay and remote release checks remain outstanding.

## Wallet review and transaction history

The review flow labels approvals separately from protocol actions. Approval rows identify the token/position approval, spender, and amount; the action uses its own confirmation label. The distinction is carried into Privy's send-request UI, the pending-transaction journal, recovery messages, and receipt presentation. Approval receipts do not imply that the following action was submitted or completed.

Receipt summaries now distinguish token-approval fees from action fees, report native transaction value separately from gas, and label bridge fees explicitly. On Base, the UI adds execution, L1 data, and operator-fee components when all are present; if receipt data is incomplete, it states that the fee total is partial.

A separate approval-history classification issue has a local fix. The previously reported close-route simulation fault has not yet been reproduced; it remains under investigation and is not claimed as resolved here.

## Portfolio and protocol reads

Wallet discovery is filtered to FxAeon's configured supported assets before it affects the asset list or completeness calculation. The headline portfolio total can retain a recent, complete value for the same wallet while a refresh is in flight; incomplete or stale reads are not converted into zero.

Ethereum portfolio and form consumers now share one canonical balance cache. Instrumented tests record one chain identity read, one native balance read, and one token multicall for concurrent consumers, and no additional reads for fresh navigation reuse. These are logical client calls in the test, not a measured production HTTP total: the production transport also performs a coalesced endpoint-chain proof on cold use and after its 60-second verification window. Wallet, session, and chain changes remain isolated. An optional indexed-data outage no longer blocks a total when the canonical supported-token balances and current prices are complete; missing prices and failed canonical reads still prevent a complete total.

Block-driven wallet refresh now refetches only stale active queries. A fresh balance or claimability query is not invalidated just because a block arrived. Manual refresh, wallet transfer events, and receipt-bound refresh retain their immediate path and cancellation of pre-receipt work.

The separate position-discovery fallback was inspected for request volume. Empty pool balances skip enumeration; previously discovered candidate IDs are cached and their ownership is revalidated before reuse. A first-time indexer deficit can still require a bounded scan of up to 4,096 IDs in 128-call multicalls per pool, with a 12-second product deadline. That cold path is expensive and is not eliminated by the wallet-balance cache change. Position state continues to refresh on new blocks; its live-state policy was not relaxed to produce a lower request count.

The targeted source comparisons are recorded in [Jumper and Curve](frontend-research-jumper-curve.md) and [Uniswap and Balancer](frontend-research-uniswap-balancer.md), with pinned upstream commits. These are bounded implementation studies, not exhaustive audits of those repositories.

The f(x) SDK and app read clients can use a bounded ordered RPC list for Ethereum and Base. Each provider URL is validated against its reviewed host and chain, chain identity is checked before use, and transient transport/upstream failures can fail over. Reverts, user rejection, and other request-level errors remain terminal. The production Content Security Policy allows the required Alchemy and Infura Ethereum/Base RPC hosts; provider keys are configured for the `fxaeon.com` browser origin.

Maintainers verified that these four GitHub deployment secrets were added on 3 October 2026 (values intentionally omitted):

- `NEXT_PUBLIC_ALCHEMY2_ETHEREUM_RPC_URL`
- `NEXT_PUBLIC_ALCHEMY2_BASE_RPC_URL`
- `NEXT_PUBLIC_INFURA_ETHEREUM_RPC_URL`
- `NEXT_PUBLIC_INFURA_BASE_RPC_URL`

These `NEXT_PUBLIC_*` values are embedded in the static browser application at build time. GitHub Secrets protect them during deployment configuration, but the resulting RPC credentials are browser-visible and must remain restricted to the intended origin and chains.

## Gas limits, Max, and leverage

Standard, Fast, and Rapid fee controls and reviewed fee caps apply to the Privy send path. There, the wallet request uses the RPC gas estimate with 20% headroom, bounded against an invalid or excessive estimate. If an approval outlives its quote, the runner refreshes the selected tier but refuses to exceed the reviewed fee ceiling. The trade Max calculation reserves the estimated gas cost at the selected maximum fee, uses a bounded iteration count and deadline, and returns concise failure messages instead of treating arbitrary route failures as underfunded estimates. With an external wallet, that wallet owns fee selection and pricing; FxAeon does not impose the Privy fee caps on external sends.

Leverage bounds now reserve margin for the SDK's debt-ratio guard and selected slippage. The displayed maximum is an input guard, not a guarantee that every route at that value will plan; the SDK and current pool state still determine route validity.

## Focused validation reported

The following focused checks were reported as passing during development:

| Area | Passing cases |
| --- | ---: |
| Gas policy, native Max, and runner | 53 |
| Trade page Strict Mode plus repeated View Max interaction on the actual AmountField | 4 |
| Privy adapter Chrome harness | 12/12 (covers all fee tiers, approval/action sends, modal preflight, and external sends without app fee caps) |
| Sequential runner | 26/26 (includes modal preflight before fresh simulation and fee estimation) |
| Review and positions layout harness | 31/31 (embedded/external fees, approval recovery, mobile CTA and expanded details) |
| Actual ActionReview approval-draft harness | 3/3 |
| State-lab browser and reviewed snapshots | 5/5 |
| SDK/RPC fallback | 13 |
| Receipt presentation | 8 |
| Portfolio | 24 |
| Realtime chain reads | 5 |
| Leverage bounds | 6 |
| Browser chain switching | 9 |

The latest consolidated `pnpm verify` run reported 543 passed and 4 skipped unit cases, then passed the production build, bundle and built-secret checks. All 193 main browser cases, 56 isolated browser cases, and 14 landing theme/viewport states passed. That command exited nonzero because its concurrent typecheck caught an optional environment-variable narrowing error in temporary fork-replay setup. The temporary setup was removed, and the full `pnpm typecheck` then passed. The unchanged browser stages were not rerun. Local execution used Node 24 and installed Chrome; repository CI uses the required Node 22 and pinned Playwright browser and remains a separate release gate.

The Anvil all-suite run passed four cases, with protocol and fxSAVE manifests verified. An earlier cold-fork SDK multicall exceeded the hosted 5-second deadline; a 60-second deadline now applies only to loopback endpoints in explicit local-fork mode. Hosted endpoints retain the 5-second limit. Historical close and bridge replay did not establish the cause of the reported live failures, so those symptoms are not claimed as conclusively resolved. Production deployment verification remains outstanding.
