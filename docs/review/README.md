# Product visual review

## Latest captured gallery

[`artifacts/refinement/generated/run-20260927T154147Z/`](../artifacts/refinement/generated/run-20260927T154147Z/)
contains 66 views and 101 PNG frames at 393×852 mobile and 1440×1000 desktop,
captured against build `34400ef`. It predates the current gas-tier feature and
needs a refreshed capture and final screenshot promotion.

Candidate `3663bdc` adds saved Standard, Fast, and Rapid gas choices, invalidates
an open review when the saved tier changes, and requires explicit review of the
updated quote. Focused fee-tier tests passed 60/60, and TypeScript and lint
checks passed; full `pnpm verify` is still running. The protected protocol suite
last passed 4/4 at fork block `26065969`, but the current fee-tier browser gate
remains pending.
The latest browser attempt stopped before signing when simulation was
unavailable; its retry was stopped during warmup for edits. No browser pass is
claimed. See [release validation](../release-validation.md).

The gallery uses fixture prices, Goldsky responses, and a test-wallet shim. The
Cloudflare preview lacks RPC environment values. Earlier user-authenticated
local checks confirmed healthy reads and matching opening/closed History
events; they do not establish transaction submission or current-candidate
behavior. Public evidence omits private wallet identity, balances, and
screenshots.

## Historical references

Earlier galleries and captures remain as before-state evidence. They do not
establish the current release gates or production behavior.
