# ADR 0001: Record architecture decisions

Date: 2026-06-15  
Status: Accepted

## Context

FxAeon coordinates a user wallet, delegated signing, third-party SDK routes, and live protocol transactions. Decisions about custody, authentication, contract trust, and broadcast controls are expensive to reverse and cannot be reconstructed reliably from old pull requests or planning documents.

## Decision

Keep lightweight Markdown ADRs in `docs/adr/`. Record the context, chosen approach, rejected alternatives, security/operational consequences, verification, and rollback for a significant decision.

Accepted decisions are superseded by a new ADR when their direction changes. Documentation may correct links and factual drift without rewriting the original rationale.

## Consequences

- Reviewers can evaluate why a security boundary exists before weakening it.
- Future changes identify which assumptions and tests must be revisited.
- ADRs add maintenance cost and must not become an unverified parallel source of product truth.

Current feature status belongs in [the capability matrix](../sdk-capabilities.md); current operational risks belong in [the threat model](../threat-model.md) and [known gaps](../GAPS.md).
