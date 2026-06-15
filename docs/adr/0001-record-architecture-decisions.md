# 1. Record architecture decisions

Date: 2026-06-15

## Status

Accepted

## Context

FxAeon is a money-path application (self-custodial trading on f(x) Protocol via a
Telegram Mini App). Several of its decisions are security-sensitive and hard to
reverse — the custody model, the auth provider, the broadcast policy, the
chain-of-trust for contract addresses. Today the reasoning behind these lives
across PR descriptions, `docs/PLAN.md`, `docs/COMPLETED.md`, and `docs/GAPS.md`.
PR descriptions are hard to find later, and the honest-limits docs describe
*current state* rather than the *decision and its alternatives*.

## Decision

We will keep a lightweight log of Architecture Decision Records (ADRs) in
`docs/adr/`, one Markdown file per decision, using Michael Nygard's template
(Context / Decision / Consequences). ADRs are immutable once accepted; a new ADR
supersedes an old one rather than editing it.

ADRs complement — they do not replace — `docs/GAPS.md` (honest current limits)
and `docs/COMPLETED.md` (what shipped and how it was verified).

## Consequences

- New significant or hard-to-reverse decisions get a short, discoverable record.
- Reviewers can see *why* a "standard" approach was rejected (e.g. why Privy
  webhooks were retired, why fork tests are kept out of CI) without archaeology.
- Small cost: one extra file per major decision. Trivial choices do not get ADRs.
