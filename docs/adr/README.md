# Architecture Decision Records

Architecture Decision Records (ADRs) document approved engineering decisions that affect this repository. They are intended to preserve context, reduce repeated debate, and give human developers and AI coding agents a stable source of truth.

Only accepted decisions belong in numbered ADRs. Draft proposals, alternatives, tradeoff discussions, and unresolved questions belong in `docs/adr/drafts/`.

## Numbering

Accepted ADRs use a four-digit sequence number and a short kebab-case title:

```text
0001-containerized-development-environment.md
0002-example-future-decision.md
```

Use the next available number when promoting an approved decision.

## History

Do not rewrite accepted ADRs to change repository history. If a new approved decision replaces or changes an earlier decision, create a new numbered ADR that supersedes the previous one and reference the older ADR from the new document.

## Accepted ADRs

- [0001: Containerized Development Environment](0001-containerized-development-environment.md)
- [0002: Shared Container Image for Development and Testing](0002-shared-container-image-for-development-and-testing.md)
