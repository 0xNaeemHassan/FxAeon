# Architecture Decision Records

This directory captures the **why** behind FxAeon's significant, hard-to-reverse
decisions. Each ADR is a short, immutable record: once a decision ships, the ADR
is not rewritten — a later ADR supersedes it.

Format: [Michael Nygard's template](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [0001](./0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [signer-policy](./signer-policy.md) | Default-deny session-signer policy (W-08) | Accepted |

## When to write one

Write an ADR when a decision:

- is expensive or risky to reverse (auth provider, custody model, chain, infra),
- trades off security vs. UX on a money path,
- deliberately rejects a "standard" approach (and you want future-you to know why).

Keep it under a page. Link to the PR that implemented it.
