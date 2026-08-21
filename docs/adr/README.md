# Architecture decision records

ADRs preserve the reasoning behind security-sensitive or costly-to-reverse decisions. They describe a decision and its consequences; they are not current feature matrices or proof that an implementation remains correct.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Maintain architecture decision records | Accepted |
| [Signer policy](signer-policy.md) | Enforce an in-process default-deny policy on the central broadcast path | Accepted |

Write a new ADR when changing custody/signing authority, chain support, the contract registry model, transaction execution invariants, authentication, or production topology. Supersede an accepted ADR rather than silently changing its decision; factual corrections and links to current source are allowed.

Use this structure:

```text
# ADR: title
Date / Status / Supersedes
## Context
## Decision
## Alternatives considered
## Consequences
## Verification and rollback
```
