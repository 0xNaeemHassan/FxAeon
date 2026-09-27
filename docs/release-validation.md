# Release validation record

## Current candidate

- Pull request: [#208](https://github.com/0xNaeemHassan/FxAeon/pull/208)
- Last fully checked commit: `de3a9574b5da3b2a9216de806931721b79269cf3`
- All six GitHub checks passed, including `pnpm verify`, dedicated Mini App E2E,
  and Cloudflare ([checks](https://github.com/0xNaeemHassan/FxAeon/commit/de3a9574b5da3b2a9216de806931721b79269cf3/checks)).
- Protected protocol suite: 4/4 passed at pinned fork block `26065969`; the
  protocol implementation is unchanged.
- History reader confirmed two successful open/close rows with matching
  receipt/router verification in 2,760 ms; `partial=false`, `hasMore=false`.
- Current protected browser run (PID 23112): started 2026-09-27 14:25:32 UTC
  from `de3a9574` plus interim working-tree changes; result pending. Do not
  claim this gate passed yet.
- Final browser proof, refreshed screenshots, and post-merge validation:
  **pending**.

The user-connected local app at `localhost:4321` completed healthy live balance
and network reads. Refresh retained known values while busy, then re-enabled.
There were zero open positions; History showed matching opening and closed
events for the same position. This is an authenticated runtime spot-check, not
a release gate. Public documentation omits balances, wallet identity, and
screenshots.

Current working-tree changes add a borderless portfolio and wallet summary,
an asset ledger, remove the duplicate Portfolio value label while preserving
the total, gate the header on
authentication, make Settings gas read-only, and invalidate slippage data when
relevant settings change. Keep the current wallet/data stack; Radix is optional
for small primitives, while LI.FI is only relevant if Move expands beyond its
current product scope. These changes still need the final verification gates.

The previous browser attempt opened and reloaded all four positions and passed
Borrow, then failed on stale Earn selectors. The selectors have since been
fixed for all three Earn states. The current run is validating that correction.

## Additional evidence

- Two focused tests passed for the glyph change made after the latest gallery.
- The 64-view, 104-frame gallery at
  [`artifacts/refinement/generated/run-20260927T121703Z/`](../artifacts/refinement/generated/run-20260927T121703Z/)
  was collectively visually audited. It predates the glyph change; refreshed
  screenshots remain pending.
- Local build `4321` uses configured Privy and requires user authentication;
  the authenticated spot-check above confirmed live reads. The Cloudflare
  preview lacks RPC environment values and is not healthy-data evidence.
- The gallery uses fixture data and makes no transaction, signature, or chain
  mutation. It documents rendered UI only.

See [testing](testing.md), [browser test gates](browser-test-gates.md), and
[visual review](review/README.md) for suite scope and screenshot provenance.
Native Telegram authentication, wallet handoff, and real bridge delivery are
not established by these checks.
