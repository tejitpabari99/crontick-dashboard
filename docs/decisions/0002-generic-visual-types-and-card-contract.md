# 0002: Generic visual types and a validated card contract

- Status: Accepted
- Date: 2026-10-05

## Context

The dashboard must show very different content (a mail table, office-hours notes, a task list, deploy status) from arbitrary agents without becoming a pile of per-source widgets. Bad files from agents must be visible, not silent.

## Decision

- **Generic, domain-agnostic types:** `markdown`, `table`, `list`, `kpi`, `media`. Agents decide content. A TickTick list is a `list`; an email summary is a `table`.
- **One contract, schema-first.** zod is the source of truth for the envelope and each type's data. JSON Schemas are generated and committed (CI checks drift); TypeScript types are inferred. One validator serves the server and the CLI `validate`.
- **Strict required fields, extras allowed.** Unknown fields are preserved everywhere so agents can store their own data; `x-` keys are reserved for agents.
- **Never silent.** Invalid, errored, or stale cards render as Broken with a reason; stale data is never shown as if current.
- **Registry model.** A fixed lifecycle with per-type modules registered in one server registry and one UI registry; the core never branches on type name. A new type is a contract module, a template, and a UI renderer.
- **Fixed action set** (`dismiss`, `complete`) rather than arbitrary actions; unsafe link and image schemes are rejected.
- **Agent guidance** is a Claude skill shipped in the package, pointing at per-type templates; `validate` is the helper.

## Alternatives considered

- Domain widgets (email widget, tasks widget): more components and per-source coupling.
- Closed strict schemas: block agents from adding useful fields.
- No validation: bad files fail silently.
- README-only guidance: agents look in skills, not READMEs.
- Arbitrary item actions: unsafe.

## Consequences

Easier: adding a type, validating before writing, evolving agents independently. Harder: generic types give less bespoke polish than a purpose-built widget; a type's contract changes affect every producing agent.

## Revisit when

A needed view cannot be expressed by the five types and extras (consider a new type), or schema drift between agents becomes a recurring failure.
