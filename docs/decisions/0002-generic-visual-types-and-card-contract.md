# 0002: Generic visual types and a validated card contract

- Status: Accepted, amended 2026-10-07 and 2026-10-08
- Date: 2026-10-05

## Context

The dashboard must show very different content (a mail table, office-hours notes, a task list, deploy status) from arbitrary agents without becoming a pile of per-source widgets. Bad files from agents must be visible, not silent.

## Decision

- **Generic, domain-agnostic types:** `markdown`, `table`, `list`, `kpi`, `media`. Agents decide content. A TickTick list is a `list`; an email summary is a `table`.
- **One card, one file; `size`; archived versions.** *(superseded 2026-10-07, see Amendment: panels are folders, `size` becomes `layout.height`, no archive.)*
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

## Amendment 2026-10-07: card folders, declared layout, single-file alerts

Design brief: [brainstorm.md](../agent_files/initial-brainstorming-20261007-1648/brainstorm.md). Owner-approved; pre-1.0, so no back-compat.

### Decision

- **Panels are folders** `<data>/feed/<id>/`: `card.json` (view definition: `type`, `title`, `data` path defaulting to `data.json` and confined to the folder, `layout`, `priority`, `notify`, `show`, `staleAfter`) and `data.json` (`updatedAt?` with file-mtime fallback, `priority?` override, `error?`, `data`, `x-` keys). View is set once; content changes constantly. The old single-file `feed/<id>.json` is dropped.
- **Declared layout, no drag or resize.** `layout.column` (`left`/`center`/`right`, default `center`), `layout.order` (integer, ties by id), `layout.height` (`S`/`M`/`L`/`auto`) replace `size`. Nothing about layout is stored in `state.json`. Three fixed columns: fixed ~300px sides, flexible center; Now zone at the top of the center column.
- **Compact presentation by engine:** low-priority panels (priority 0 or 1) render as title chips in their own slot. Done cards leave the columns and are listed, with ticked alerts, in a full-width **Completed** section below them (newest first; Reopen returns a card; ticked alerts for 7 days, newest 50). A header filter **All / Alerts / Cards** scopes the page. *(Amended 2026-10-08: replaces the earlier chip treatment of Done cards and the bottom Done tray.)*
- **Alerts are single files** `feed/alerts/<id>.json`: `title`, one-line `text` (about 200 chars max), `link?`, `priority?`, `notify?`, `show?`, `updatedAt?`. No type, no layout. Shown as one-line rows in a full-width strip; ticking moves the file to `feed/alerts/.done/`.
- **No archive.** Overwritten `data.json` is not kept; the `retention` card field and `retentionDefault` config are removed.
- **JSON with `$schema`:** `card.json` carries a `$schema` reference for editor validation (schemas still generated from zod and committed). CLI gains `new <id> --type <t>` (scaffold a folder) and `validate <folder>` (checks both files and alert files).
- Only a new `data.json` version counts as new content (resets Done, notifies); `card.json` edits re-render live only.

### Supersedes

- "One card, one file" (also ADR 0001's "card config and data are one file").
- `size` (replaced by `layout.height`), drag/resize grid placement, and layout persisted in `state.json`.
- Bottom Done tray, and Done cards kept as chips in their own slot (both replaced by the Completed section).
- Archive of previous versions, `retention`, `retentionDefault` (also "archives" in ADR 0001).

### Consequences

Easier: agents rewrite only content; layout is plain files, diffable and reviewable; less server mechanism (no archive module, no grid dependency); schema editor support. Harder: two files per panel (mitigated by `new` and `validate`); no-op `data.json` rewrites count as new content when `updatedAt` is omitted (can re-notify); no way to rearrange from the UI; no recovery of overwritten data.

### Unchanged

The five visual types and their data schemas, the strict-required/extras-allowed contract, the never-silent Broken rule, the registry model, and the fixed action set.
