---
status: in-progress
summary: 8 tasks — minimal scaffold, formats/helpers, envelope, per-type schemas, registry + validator, templates + generated schemas, fixtures/fuzz/portability tests.
date: 2026-10-05
---
# Tasks: Card contract & type registry schemas (01)
Source of truth: docs/agent_files/initial-brainstorming/01-card-contract/PRD.md. Zod 4 is the single schema source; `validateCardFile` is the only validation entry point. 01 is implemented first, so Task 1 creates the minimal repo scaffold that 06 later completes. No PRD `[OPEN]` items remain.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Minimal repo scaffold | none | done |
| 2 | Formats and helpers | 1 | done |
| 3 | Envelope schema | 2 | done |
| 4 | Type schemas: markdown, kpi, media | 2, 3 | in-progress |
| 5 | Type schemas: table, list (cells, links, actions) | 2, 3 | todo |
| 6 | Registry and `validateCardFile` | 4, 5 | todo |
| 7 | Templates and generated JSON Schemas | 6 | todo |
| 8 | Negative fixtures, fuzz, portability tests | 6, 7 | todo |

## Task 1 — Minimal repo scaffold
What it is / what it means: Greenfield repo has no package yet; 01 needs build, test and lint to land code. 06 owns the final layout (package.json, tsup, tsconfig, eslint, vitest configs) and completes it later; this task must not diverge from it.
What changes at a high level: Create `package.json` (name `crontick-dashboard`, `type: module`, `engines.node >=22.5`, deps `zod`, `croner`; dev deps typescript, vitest, eslint, tsx), `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `.gitignore` for `dist/`, and empty `src/contract/`, `src/index.ts`, `scripts/`, `tests/contract/` per 06's layout block. Scripts limited to `typecheck`, `lint`, `test`, `gen:schemas`; no tsup, bin, UI or CI yet (06). Add a trivial passing test to prove the toolchain.
Done when: `npm install`, `npm run typecheck`, `npm run lint`, `npm test` all pass; layout paths match 06's block (C1, C3).

## Task 2 — Formats and helpers
What it is / what it means: Shared primitives every schema and 02 rely on (Formats section, Link rules).
What changes at a high level: In `src/contract/formats.ts`: duration schema + `parseDuration` to ms (`^[1-9]\d*(m|h|d|w)$`, max 3650d); 5-field cron validation via croner (aliases and 6-field rejected); RFC 3339 timestamp with offset/`Z`; list `due` (date or datetime); `Link` schema (http, https, mailto, ms-outlook, 2048 max; everything else rejected) and the separate media `src` rule (http(s) or `data:image/*`); `windowActive(show, now, {timezone?})` including `for` omitted = until end of local day, no `show` = always. Unit tests per rule, including timezone/day-boundary cases.
Done when: format tests pass for valid and invalid inputs listed in the PRD; helpers import with no Node-only or DOM dependency (C3, C5).

## Task 3 — Envelope schema
What it is / what it means: The fields every card file carries, with additional properties preserved (C2, C4, C7).
What changes at a high level: `envelope.ts` with `id` (lowercase slug, Windows-reserved and trailing-dot blocked), `kind`, `type`, `title`, `updatedAt`, `priority` (0-5, default 2), `notify`, `show`, `staleAfter`, `retention`, `size`, `error` (empty string normalized to null; non-empty stays valid, not a failure), and `data` optional only when `error` is non-null. Unknown keys pass through untouched; `x-` documented as reserved. Export inferred types.
Done when: tests cover defaults, id rules (`CON`, `A/b`, uppercase, `nul.txt`, trailing `.`), extras preserved, `error` handling, and `data` omission rules.

## Task 4 — Type schemas: markdown, kpi, media
What it is / what it means: Simplest per-type `data` shapes, including the kpi single-shape normalization (per-type table, RESOLVED kpi decision).
What changes at a high level: `types/markdown.ts` (`text` <=100k); `types/kpi.ts` (`items` 1-12 `KpiMetric` with state, trend, link; flat shorthand normalized to `items` of length 1; both forms present = invalid); `types/media.ts` (`items` 1-50 with `src` rule, optional `layout`; video rejected). All links use Task 2's rules; extras preserved on items and metrics.
Done when: tests pass for kpi items form, flat normalization, both-forms rejection, media `src` allow/deny (`file:`, video), and extras preserved.

## Task 5 — Type schemas: table, list
What it is / what it means: The generic, expandable types — free-form columns, cell-level links, list actions and write-back fields (Expandable format, Actions).
What changes at a high level: `types/table.ts`: columns as strings or `{key?,label,sort?}`, `rows` with `cells` and optional row `link`, `Cell` scalar or `{text, link?}`, `defaultSort`, `searchable`, row/column length check, exported `cellText`. `types/list.ts`: `ListItem` with `id`, `subtitle`, `checked`, `checkedAt`, `due`, `link`, `links[]` (<=5), `action` (`dismiss`/`complete`, shorthand strings normalized, unknown type invalid), `id` required and unique when `action` is present; `emptyText`.
Done when: tests pass for cell links, `javascript:` cell link rejected, length mismatch, `due` forms (`tomorrow` rejected), `links[]`, action normalization, missing item id, `{type:"ticktick.complete"}` rejected, extras preserved on rows, cells and items.

## Task 6 — Registry and `validateCardFile`
What it is / what it means: The single place types are registered (D7) and the only validation entry point for 02, 06 and tests.
What changes at a high level: `registry.ts` mapping type to schema, example name and allowed kinds (alerts = markdown/list/kpi only); `validate.ts` implementing the PRD API: never throws; handles unreadable/non-UTF-8, empty, over 1 MB, malformed JSON, non-object, unknown type (with `id` populated), id vs filename stem mismatch, kind/type pair, schema issues with JSON-pointer paths, human one-line `message`; `error` card returns `ok`; warnings (e.g. future skew > 5 min); `broken.id` when parseable. `index.ts` and `src/index.ts` export `validateCardFile`, `parseDuration`, `windowActive`, `listTypes`, `getExample`, `cellText`, `Card` types.
Done when: tests assert each BrokenReason, `error:"x"` returns ok, `staleAfter` never evaluated, alert with `show` ok, table on alert broken (C6, C7).

## Task 7 — Templates and generated JSON Schemas
What it is / what it means: Realistic examples for agents and the committed JSON Schema delivered per D9; C1's single-source guarantee.
What changes at a high level: five `templates/<type>.example.json` (email table demonstrating cell link, list with `complete` action and agent-private extra, kpi with several metrics, etc.), `getExample`/`listTypes` wired to them; `scripts/gen-schemas.ts` using `z.toJSONSchema` to write `schemas/envelope.json`, one per type and `card.json` (committed); where refine-based rules are lossy, note them in schema descriptions. Tests: every example validates ok; a registered type missing an example or component name fails; regeneration diffs clean against committed `schemas/`; a stock JSON Schema validator accepts all examples.
Done when: `npm run gen:schemas` produces no diff and the stale-schema test is green.

## Task 8 — Negative fixtures, fuzz, portability tests
What it is / what it means: Acceptance-criteria sweep proving the contract rejects what it should and is safe to bundle into server and CLI.
What changes at a high level: negative fixture per rule (missing field, bad ids, `7 days`, 6-field cron, naive timestamp, row/column mismatch, unknown action, `javascript:`/`data:`/`file:`/`ftp:` links, table on alert; `ms-outlook:` and `mailto:` accepted); truncated JSON and `[]` reasons; extras on envelope/data/rows/items/metrics preserved; fuzz of `validateCardFile` with binary, empty and 5 MB inputs never throwing; a check that `src/contract` imports no Node-only or DOM modules.
Done when: all Acceptance Criteria bullets of the PRD map to passing tests and `npm run lint && npm run typecheck && npm test` is green.

## Manual steps (owner)
None for 01.
