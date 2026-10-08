---
status: draft
summary: Card-folder contract — zod schemas for card.json, data.json and alert files, a pure folder-level validator (two-step, no fs), generated schemas and folder templates.
date: 2026-10-08
---
# PRD: Card folder contract (SP01)
Repo/branch: crontick-dashboard / `initial-brainstorming` · Depends on: none · Owns: `src/contract/**`, `src/constants/contract.ts`, `src/constants/error-codes.ts` (reason lists), `scripts/schemas-build.ts` + `gen-schemas.ts`, `schemas/**`, `templates/**`, `tests/contract/**`, `docs/reference/errors.md` (reason tables only; rest of docs = SP04)

## TL;DR
`envelope.ts` splits into three zod schemas: card.json (view def), data.json (content), alert file. A pure validator turns raw file contents (+ mtime) into one of: ok card, "no data yet" card, Broken, or skipped-with-warning. SP02 reads files and calls it; SP04's `validate` calls it. Ids come from folder/file names, never from file bodies. Per-type data schemas and the registry shape stay; templates become example folders.

## Problem
The v0.1.0 envelope mixes view config and agent content in one file, carries `size`/`retention`/panel `kind`, and its validator takes one text blob. The folder model needs two panel files plus an alert file, a safe `data` path, priority/updatedAt resolution across files, and distinct outcomes (skip vs Broken vs no data).

## Goals / Non-Goals
Goals: exact field ownership per file; one pure validator both server and CLI call; safe `data` path rule; generated JSON Schemas + folder templates; forward-compat (unknown fields kept, `x-` reserved).
Non-goals: reading files, watching, Done/new-content logic, stale/Now/column computation (SP02); CLI commands, SKILL.md, prose docs (SP04); UI; data-optional types (future flag, only a seam here); changing the five per-type data schemas.

## Requirements

### Field ownership
| Field | card.json | data.json | alert file |
|---|---|---|---|
| `$schema` | opt string (opaque, never resolved by validator) | same | same |
| `type` | req, string (registry check in validator) | no | no |
| `title` | req, 1–200 | no | req, 1–200 |
| `text` | no | no | opt; when present 1–200 chars, no `\n \r U+2028 U+2029` |
| `link` | no | no | opt `Link` (existing `linkSchema`; rendered clickable by SP03) |
| `data` | opt file name, default `data.json` (see rule) | req payload object (per-type schema), unless `error` set | no |
| `layout` | `{column: left\|center\|right = center, order: int = 0, height: S\|M\|L\|auto = auto}`, whole object optional, nested defaults | no | no |
| `priority` | opt int 0–5 | opt int 0–5, overrides card | opt int 0–5, default 2 |
| `notify`, `show`, `staleAfter` | `notify` bool = false; `show` {cron, for?}; `staleAfter` duration | no | `notify`, `show` only |
| `updatedAt` | no | opt RFC 3339; fallback = mtime | same as data |
| `error` | no | opt string\|null, `""`→null; non-empty = agent-declared failure, `data` then optional and not validated | no |
| `id` | not a field: folder name | not a field | not a field: filename stem |
| `size`, `retention`, panel `kind` | removed | | |

`error` stays in data.json: it is a content signal the agent writes at run time (failed fetch) without touching the view def. Effective values: `priority = data.priority ?? card.priority ?? 2`; `updatedAt = data.updatedAt ?? ISO(mtime)`, with `updatedAtSource: 'data'|'mtime'` exposed. A stray `id` key in any file is preserved but ignored, plus a warning (folder name wins).

All objects are `looseObject`: unknown keys preserved, `x-` reserved for agents. Strict-looking keys not listed (e.g. `span`) are kept silently, so future fields stay addable.

### `data` path rule (lexical, pure)
`data` is a plain file name inside the card folder: no subfolders. Valid iff: string, 1–200 chars, no NUL/backslash/control chars, no `/` (single segment), not dot-prefixed (so not `.`/`..`), ends `.json`, not `card.json`. Anything else → `data-path-invalid` (card.json invalid, folder skipped). Symlinks leading outside the folder cannot be checked purely: SP02's `readCardFolder` must `realpath` the data file and confirm containment before reading, else treat as `data-path-invalid`.

### Validator API (`src/contract/validate.ts`, no fs/path imports)
```ts
parseCardDef(folderId, cardText: string | null): DefResult        // step 1: gives SP02 the data path
validateCardFolder(i: { folderId; cardText: string | null;
  data: { text: string; mtimeMs: number } | { absent: true } | { unreadable: string };
  now?: Date }): FolderResult
validateAlertFile(i: { name: string /* file name */; text: string; mtimeMs: number; now?: Date }): AlertResult
isCardFolderName(name): 'ignore' | 'reserved' | 'ok' | 'invalid'  // dot-prefixed → ignore; 'alerts' → reserved
```
`FolderResult` (discriminant `status`):
- `ok`: `{ card, warnings }`. `card` = id, `type`, `title`, `layout` (defaults applied), effective `priority`, `notify`, `show?`, `staleAfter?`, effective `updatedAt` + `updatedAtSource`, `error: string|null`, validated `data?`, plus preserved extras (`def` and `content` raw objects kept for write-back).
- `no-data`: card.json valid, data absent. Same shape minus content; SP02 renders muted "No data yet".
- `broken`: `{ reason, message, issues, id, def? }`. `def` (layout etc.) is included whenever card.json parsed so the Broken card still sits in its slot. Reasons: `unreadable | malformed-json | not-object | too-large | schema-invalid | unknown-type` (data.json problems, plus `unknown-type`).
- `skipped`: `{ reason, message, issues, id? }`, reasons `card-def-missing | card-def-invalid | data-path-invalid | invalid-id | reserved-id`. Surfaced as snapshot warnings.
`AlertResult`: `ok { alert, warnings }` or `broken { reason, message, issues, id }` (same reasons minus `unknown-type`); over-long or multi-line `text` (when present) = `schema-invalid`; missing `title` = `schema-invalid`. SP02 also uses `validateAlertFile` for `feed/alerts/.done/*.json`. Never throws. Size caps: card.json 64 KB, data.json 1 MB (`MAX_CARD_BYTES`), alert 16 KB. BOM stripped; U+FFFD/lone surrogate = `unreadable` (as today).

Check order: id name → card.json text sanity → def schema (incl. path rule) → `unknown-type` (Broken, def kept) → data presence → data text sanity → data-file schema → per-type payload via registry (skipped when `error` set) → warnings.

### mtime fallback and clock skew
Skew warning (`CLOCK_SKEW_MS`, 5 min) applies to the effective `updatedAt` whichever source, worded per source ("updatedAt" vs "file mtime is in the future"). It stays a warning, never clamps: SP02 decides ordering use. Identity of a content version = explicit `updatedAt` if present else mtime; the contract only exposes both (`updatedAtSource`); new-content semantics are SP02's.

### Registry (`registry.ts`)
Entry = `{ schema, summary, template: { card, data } }`; `allowedKinds`/`CardKind` removed; templates embedded as JSON modules from `templates/<type>/{card,data}.json` (bundler-safe, no fs). `getExample(type)` → `{ card, data }`. Seam: validator asks `dataRequired(type): boolean` (one function in registry, currently always `true`, comment points at a future per-type `dataOptional` flag). Not implemented.

### Schemas and templates
Generated into `schemas/` (committed, CI drift check unchanged; stale files deleted): `card-def.json` (type as enum of registered types), `data.json` (generic), `data.<type>.json` x5 (data file with `data` bound to that type), `alert.json`, `<type>.json` x5 (bare payload, unchanged). Removed: `envelope.json`, `card.json`. LOSSY_NOTES updated (path rule, id from folder, defaults, `error`).
Templates: `templates/<type>/card.json` + `data.json` (x5) and `templates/alert/alert.json`; each carries a `$schema`.

`$schema` resolution (decision): the string is always `../../schemas/<file>`. Same text resolves in the repo/npm package (`templates/<t>/card.json` → `schemas/`) and in a data dir (`<data>/feed/<id>/card.json` → `<data>/schemas/`; alerts `feed/alerts/x.json` likewise), which SP04's `syncSchemas` populates by copying packaged schemas (SP02 calls it once at server startup). Relative is intentional: editors resolve `$schema` relative to the file, and it survives moving the data dir. Offline, no URL to publish. Validator ignores the value.

### Reasons / errors
`src/constants/error-codes.ts`: add `BROKEN_REASONS` and `SKIP_REASONS` const arrays (typed source for validator, snapshot, errors.md); no new HTTP codes (SP02 drops `INVALID_LAYOUT`). errors.md: replace the Broken-reasons table (drop `id-mismatch`; `duplicate-id` becomes unreachable for folders, SP02 confirms), add a "Skipped folders" table and a "No data yet" note (a state, not an error).

## Architecture
```
SP02 reads card.json ─► parseCardDef ─► def.dataPath ─► SP02 reads+realpath-checks data file
                         └────────► validateCardFolder(cardText, data, now) ─► FolderResult
alerts/<id>.json, alerts/.done/<id>.json ─► validateAlertFile
```
Modules: `card-def.ts`, `data-file.ts`, `alert.ts` (zod + inferred types), `validate.ts`, `registry.ts`, `formats.ts` (unchanged), `index.ts` (public: drops `validateCardFile`, `Envelope*`; adds new validators/types). Browser-safe, pure.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Validator shape | Pure; callers pass contents + mtime; `parseCardDef` exposes data path first | Validator takes a reader fn / does fs | Pure = testable, browser-safe; two-step needed because data path lives in card.json |
| 2 | Outcomes | `ok / no-data / broken / skipped` | Throw / single Broken kind | Brief distinguishes skip, Broken, no-data |
| 3 | Unknown `type` | Broken with `def` | Skip | Slot known, user sees "Unsupported type" |
| 4 | `error` location | data.json | card.json | Runtime content signal |
| 5 | Id | Folder/file name only | `id` field + mismatch check | No mismatch class of bug; `id-mismatch` dropped |
| 6 | `data` path | Plain file name in the card folder (no `/`) + realpath containment in SP02 | Subfolders allowed | No nested watching; symlinks need fs |
| 7 | `$schema` | Relative `../../schemas/…`, schemas copied into `<data>/schemas/` (owner 2026-10-08) | Absolute path; CDN URL; server-served | Offline, stable, one string for repo/package/data dir; editors resolve relative to file; survives moving data dir |
| 10 | Alert fields | `title` req, `text` opt (1–200, single line), `link` opt | Both req | Owner 2026-10-08 |
| 11 | Alert ids | Own namespace, `alert:<id>` in API state keys and dashboard saved state | Shared with card ids | Owner 2026-10-08 |
| 12 | no-data staleness anchor | card.json mtime (SP02) | First seen | Owner 2026-10-08; contract exposes nothing |
| 8 | Priority default | Resolved in validator (data ?? card ?? 2) | Resolve in compute | One place; compute sees one number |
| 9 | Per-type data schemas `data.<type>.json` | Generated | Generic only | Editor autocomplete for agents |

## Risks / Open Questions
- [RESOLVED: owner 2026-10-08 — plain file name, no subfolders; rule and tests tightened, SP02 has no nested watching] Data path subdirectories.
- [RESOLVED: owner 2026-10-08 — alerts have own ids, `alert:<id>` in API state keys and dashboard saved state; `alerts` reserved only for card folders] Alert id vs card id.
- [RESOLVED: owner 2026-10-08 — relative `../../schemas/<file>`, schemas copied into `<data>/schemas/`] `$schema` strategy.
- [RESOLVED: owner 2026-10-08 — `staleAfter` counts from card.json mtime when no data yet; SP02 implements] "No data yet" anchor.
- [RESOLVED: owner 2026-10-08 — `title` required, `text` optional] Alert fields.
- [DEFERRED] `dataOptional` per-type flag (seam only).
- [RESOLVED: brief] Old `feed/<id>.json` and archive: no support.
- Risk: mtime fallback re-notifies on no-op rewrites (brief-accepted); the validator surfaces `updatedAtSource` so SP02/skill can mitigate.

## Acceptance Criteria
- `npm run validate` green; `npm run gen:schemas` leaves no git diff; templates (5 folders + alert) validate `ok` and against generated schemas via ajv.
- Tests (`tests/contract/`) cover: defaults for layout/priority/notify; `size`/`retention`/`kind` ignored as extras; path rule table (`/` anywhere incl. leading/nested, `..`, dot-prefixed, backslash, NUL/control, non-json, `card.json`, >200 chars, valid plain name); unknown fields and `x-` preserved in all three files; priority/updatedAt precedence and mtime fallback; skew warning for both sources; absent data → `no-data`; `error` set with missing/invalid `data` → ok; invalid data → Broken with `def`; unknown type → Broken; skip reasons incl. reserved/dot/invalid id; alert without `text` → ok; with `text` >200 or multi-line → Broken; missing `title` → Broken; `.done/` file names accepted; purity (no `node:` imports in `src/contract`).
- `validateCardFile`, `envelope.ts`, `id-mismatch`, `allowedKinds` removed; no references remain in `src/contract`.
