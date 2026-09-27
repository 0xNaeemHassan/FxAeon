# Release validation record

## Current candidate

- Pull request: [#208](https://github.com/0xNaeemHassan/FxAeon/pull/208)
- Current published head: `ae9a0d640e76cfff53a2d47e2f8bcdbcf3ce7c60`. Secret Scan and
  Supply Chain passed; Client CI and Mini App E2E were still running at the
  latest check ([checks](https://github.com/0xNaeemHassan/FxAeon/commit/ae9a0d640e76cfff53a2d47e2f8bcdbcf3ce7c60/checks)).
- Protected protocol suite: 4/4 passed at pinned Ethereum fork block
  `26065969`; protocol implementation is unchanged. It covered four real 25%
  partial reductions across ETH/BTC long/short positions and fxSAVE deposit,
  instant withdrawal, queued withdrawal, cooldown, and claim.
- History reader confirmed matching receipt/router-verified opening and closing
  events in 2,760 ms (`partial=false`, `hasMore=false`). No wallet or
  transaction identifiers are included here.
- Latest protected browser attempt failed at 2026-09-27 15:01:31 UTC. It opened
  and reloaded all four positions, verified external ownership and responsive
  layout, and passed Borrow. Earn stopped because a strict selector matched a
  visible primary fact and a hidden advanced duplicate. The selector now filters
  to visible rows without weakening the assertion. The corrected full browser
  retry is pending; this is not a browser pass.
- Refreshed screenshots and post-merge validation remain pending. Keep the PR
  unmerged until the current-head checks and protected browser retry pass.

The user-authenticated local app at `localhost:4321` completed healthy live
balance and network reads. Known values stayed visible while refresh was busy,
then refresh re-enabled. There were zero open positions; History showed the
opening and closed events for the same position. This is a runtime spot-check,
not a release gate. Public documentation omits balances, wallet identity, and
screenshots.

The current UI changes use a borderless portfolio and wallet hierarchy, an asset
ledger, and remove the duplicate Portfolio value label while preserving the
total. The header is gated on authentication; Settings keeps gas read-only and
invalidates slippage-dependent data when relevant settings change. The landing
page is Telegram-first with official product marks and an illustrative preview.

## Visual evidence

- The 64-view, 104-frame gallery at
  [`artifacts/refinement/generated/run-20260927T121703Z/`](../artifacts/refinement/generated/run-20260927T121703Z/)
  was collectively audited, including Docs, Privacy, Login, and all state-lab
  themes/stages. It predates the later glyph change; two focused tests passed
  for that change. Refreshed screenshots and final promotion remain pending.
- The gallery uses fixture data and documents rendered UI only. The Cloudflare
  preview lacks RPC environment values. The authenticated local spot-check
  confirmed healthy live reads, but does not establish transaction submission
  or production behavior.

See [testing](testing.md), [browser test gates](browser-test-gates.md), and
[visual review](review/README.md) for suite scope and screenshot provenance.
Native Telegram wallet handoff and real cross-chain delivery are outside the
local Ethereum fork proof.
