# ADR: Default-deny session-signer policy (W-08)

Date: 2026-06-15
Status: Accepted
Implements: `apps/bot/src/core/signerPolicy.ts`, `apps/bot/policy/signer.policy.json`

## Context

A user grants the bot a **session signer** (a scoped key in their Privy embedded
wallet) so trades can be executed without a tap-to-sign per transaction. That key
is powerful: it can sign anything the bot hands to Privy. The only thing between a
buggy or compromised route builder and the user's funds is the policy applied
before broadcast. The route builders consume third-party data (the fx-sdk),
deep-link / callback payloads are client-controlled, and contract addresses are a
classic place for typos or fabrication (see AUDIT P0-4 — a fabricated `CONTRACTS`
registry was found and deleted in W-04).

Privy's hosted Policy Engine exists, but it is an *enterprise* feature and a
second source of truth that can drift from the code. We want a guarantee that is
(a) enforced in our own code on the single broadcast path, and (b) impossible to
silently desynchronise from the audited address registry.

## Decision

Enforce a **fail-closed, default-deny allow-list inside `executeRoute`** — the one
sanctioned broadcast path, so every trade type (positions, earn, limit orders,
automation, bridge) is screened. Invariants:

1. `tx.to` MUST be a contract in the verified `ADDRESSES` registry
   (`packages/shared/src/addresses.ts`), each entry proven to have mainnet
   bytecode by `scripts/verify-addresses.mjs`.
2. ERC-20 `approve` / `increaseAllowance` may only name a **spender** that is a
   registry contract or the user's own wallet (blocks "approve attacker, drain
   later" even against a legitimate token).
3. ERC-20 `transfer` / `transferFrom` may only send to a registry contract or the
   user's own wallet.

The enforced allow-list is **derived from `ADDRESSES` at runtime**, never read from
the JSON file. `apps/bot/policy/signer.policy.json` is a generated artifact
(`scripts/gen-signer-policy.mjs`) kept for review and diffing; a unit test
(`apps/bot/tests/signer-policy.test.ts`) and a CI gate
(`gen-signer-policy.mjs --check`, Supply chain workflow) assert it mirrors the
registry exactly, so the two can never silently drift.

Mode is `SIGNER_POLICY_MODE`, default **`enforce`**. An `observe` valve exists for
exactly one scenario: a new but legitimate f(x) peripheral appearing in a route —
flip to `observe` for seconds, add the verified address to `ADDRESSES`, regenerate,
flip back, rather than bricking trades. `off` is testing-only.

## Alternatives considered

- **Privy hosted Policy Engine only.** Rejected as the *sole* control: enterprise
  feature, off-repo, can drift from code. (We still pin a `PRIVY_POLICY_ID` where
  available, but the in-code check is the load-bearing guarantee.)
- **Hand-maintained allow-list of addresses + 4-byte selectors** (as some external
  "upgrade" templates propose). Rejected: a second hand-edited list of money-path
  addresses is strictly *less* safe than deriving from the one audited registry.

## Consequences

- A route targeting anything outside the audited registry cannot broadcast.
- The allow-list and the audited registry cannot diverge (runtime derivation +
  unit test + CI `--check`).
- Adding a legitimate new f(x) contract is a deliberate, reviewable two-step:
  add to `ADDRESSES` (which `verify-addresses` checks on-chain), regenerate the
  artifact. Reviewed quarterly; changes recorded by superseding this ADR.
