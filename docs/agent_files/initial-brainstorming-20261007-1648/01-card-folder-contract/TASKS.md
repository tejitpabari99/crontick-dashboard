---
status: draft
summary: SP01 card-folder contract — 8 tasks - constants, zod schemas, registry/templates, pure validator, public API cleanup, schema generation, errors.md, contract acceptance tests.
date: 2026-10-08
---
# Tasks: Card folder contract (SP01)
Source of truth: docs/agent_files/initial-brainstorming-20261007-1648/01-card-folder-contract/PRD.md. All PRD items are RESOLVED or DEFERRED; no open questions block these tasks. Tests ship with each task under `tests/contract/`; Task 8 closes the acceptance-criteria gaps.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Contract constants and reason lists | — | done |
| 2 | Card-def, data-file and alert zod schemas | 1 | done |
| 3 | Registry rework and folder templates | 2 | done |
| 4 | Pure folder-level validator | 1, 2, 3 | done |
| 5 | Public API cleanup, envelope removal | 4 | done |
| 6 | Schema generation and drift check | 2, 3, 5 | done |
| 7 | errors.md reason tables | 1, 4 | done |
| 8 | Acceptance tests: templates, purity, removals | 4, 5, 6 | done |

## Task 1 — Contract constants and reason lists
What it is / what it means: shared typed constants the schemas and validator use (Decisions 2, 6; Validator API size caps; skew rule).
What changes at a high level: add size caps (card 64 KB, data 1 MB, alert 16 KB), `CLOCK_SKEW_MS` (5 min), and the data-path rule limits to the contract constants. Add `BROKEN_REASONS` and `SKIP_REASONS` const arrays to the error-codes constants, with exact reason sets from the PRD. No new HTTP codes.
Done when: constants exported and typed; `id-mismatch` absent from reason lists; `npm run validate` green.

## Task 2 — Card-def, data-file and alert zod schemas
What it is / what it means: split the v0.1.0 envelope into three `looseObject` schemas per the Field ownership table (Decisions 4, 5, 8, 10).
What changes at a high level: new card-def schema (type, title, optional data path with lexical path rule yielding `data-path-invalid`, nested layout defaults, priority, notify, show, staleAfter), data-file schema (payload, priority, updatedAt, `error` with `""`→null and payload optional when set), and alert schema (title required, single-line `text` 1–200, link, priority default 2, notify, show). Unknown keys and `x-` preserved; `size`/`retention`/`kind` removed; stray `id` kept and flagged.
Done when: tests cover defaults, path-rule table, extras preservation, alert text/title rules; `npm run validate` green.

## Task 3 — Registry rework and folder templates
What it is / what it means: registry entries carry embedded example folders instead of allowed kinds (Registry section; Decision 9 inputs).
What changes at a high level: entry shape becomes schema, summary, template {card, data}; drop `allowedKinds`/`CardKind`; add `getExample(type)` and a single `dataRequired(type)` seam (always true, comment pointing at future `dataOptional`). Create `templates/<type>/card.json` + `data.json` for the five types and `templates/alert/alert.json`, each with a relative `$schema` of `../../schemas/<file>`, embedded as JSON modules (no fs).
Done when: registry exposes examples for all five types; templates parse against the new schemas; `npm run validate` green.

## Task 4 — Pure folder-level validator
What it is / what it means: the single validator SP02 and SP04 call (Decisions 1, 2, 3, 5, 8; Check order; mtime/skew section).
What changes at a high level: add `parseCardDef`, `validateCardFolder`, `validateAlertFile`, `isCardFolderName` with no fs/path imports, never throwing. Implements the PRD check order, BOM and U+FFFD handling, outcomes ok / no-data / broken (def kept) / skipped, effective priority and updatedAt with `updatedAtSource`, skew warning for both sources, `unknown-type` Broken, `error`-set skipping payload validation, `.done/` alert names accepted.
Done when: tests cover the outcome, precedence, skew, skip-reason and error-signal cases from the acceptance list; `npm run validate` green.

## Task 5 — Public API cleanup, envelope removal
What it is / what it means: retire the envelope model (Architecture: index.ts; final acceptance bullet).
What changes at a high level: remove `envelope.ts`, `validateCardFile`, `Envelope*` exports and any `allowedKinds`/`id-mismatch` references in `src/contract`; export new validators and types from the contract index. Where non-contract code still imports removed symbols, apply the minimum shim or stub so the build passes, leaving real rewrites to SP02.
Done when: grep finds no removed symbols under `src/contract`; `npm run validate` green.

## Task 6 — Schema generation and drift check
What it is / what it means: regenerate committed JSON Schemas from the new contract (Schemas and templates section; Decision 9).
What changes at a high level: update the schema build and gen scripts to emit `card-def.json` (type enum of registered types), generic `data.json`, `data.<type>.json` x5, `alert.json`, and the five bare payload `<type>.json`. Delete stale `envelope.json` and `card.json`. Update LOSSY_NOTES for path rule, id from folder, defaults, `error`. Commit `schemas/`.
Done when: `npm run gen:schemas` leaves no git diff; stale files gone; `npm run validate` green.

## Task 7 — errors.md reason tables
What it is / what it means: reason documentation limited to the tables SP01 owns (Reasons / errors section).
What changes at a high level: in `docs/reference/errors.md`, replace the Broken-reasons table (drop `id-mismatch`, mark `duplicate-id` unreachable for folders, pending SP02 confirmation), add a "Skipped folders" table, and add a "No data yet" note describing a state rather than an error. Leave all other docs to SP04.
Done when: tables match `BROKEN_REASONS`/`SKIP_REASONS` exactly.

## Task 8 — Acceptance tests: templates, purity, removals
What it is / what it means: close the acceptance criteria not covered per task.
What changes at a high level: add `tests/contract/` checks that the five folder templates plus the alert template validate `ok` and also pass the generated schemas via ajv; a purity check that nothing in `src/contract` imports `node:` modules; a check that removed symbols are gone; and any remaining gaps from the acceptance test list.
Done when: all acceptance bullets map to a passing test; `npm run validate` green with `gen:schemas` clean.

## Closing note
The PRD has no Manual steps section; no owner-only actions identified. SP02 must still confirm `duplicate-id` unreachability and own the realpath containment check for the data file.
