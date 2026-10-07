# Architecture Decision Records

ADRs capture a single significant, lasting technical decision for crontick-dashboard: the context, the choice, the alternatives evaluated, and the consequences. The design history that produced them lives in `docs/agent_files/initial-brainstorming/` (the brainstorm's 32-row decision log and the six PRDs).

## When to write a new ADR

Write one only for a decision that is major and lasting: it shapes the architecture, changes a module boundary or public surface, adds a dependency that constrains future choices, or reverses a previous major decision. Do not write one for a routine implementation choice, a bug fix, a flag rename, or an incremental refinement.

When a change refines, narrows, or partially reverses a decision an existing ADR covers, **update that ADR in place** (edit Decision/Consequences, update the Date, note what changed and why) instead of adding a number. Keep the set small on purpose.

A change to a rule in [design principles](../tech/design-principles.md) that reflects a lasting design decision also needs an ADR.

## File naming

`NNNN-kebab-case-title.md`, zero-padded to four digits, sequential, never reused. `0000-template.md` is the blank template.

## Status values

| Status | Meaning |
|--------|---------|
| `Proposed` | Under discussion, or implemented but not yet verified as described in the ADR. |
| `Accepted` | Active and in effect. |
| `Superseded by ADR-NNNN` | Replaced by a newer decision. |
| `Deprecated` | No longer relevant. |

## Index

| # | Title | Status | Date |
|---|-------|--------|------|
| [0001](0001-custom-build-and-runtime-model.md) | Custom build and local runtime model | Accepted, amended 2026-10-07 | 2026-10-07 |
| [0002](0002-generic-visual-types-and-card-contract.md) | Generic visual types and a validated card contract | Accepted, amended 2026-10-07 (card folders, declared layout, no archive) | 2026-10-07 |
| [0003](0003-toolchain-and-distribution.md) | Toolchain and distribution | Accepted, amended 2026-10-07 | 2026-10-07 |
| [0004](0004-os-notifications-via-node-notifier.md) | OS notifications via node-notifier | Proposed | 2026-10-05 |
