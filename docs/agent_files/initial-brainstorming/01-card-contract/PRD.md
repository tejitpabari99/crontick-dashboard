---
status: draft
summary: Card file contract — envelope + 5 per-type data schemas (Zod source, generated JSON Schema), formats, shared validator API, shipping layout.
date: 2026-10-05
---
# PRD: Card contract & type registry schemas (01)
Repo/branch: crontick-dashboard / `initial-brainstorming` · Depends on: none · Owns: `src/contract/**` (schemas, types, validator, formats), `templates/**` (examples), `scripts/gen-schemas.ts`, generated `schemas/*.json`

## TL;DR
One TypeScript package module defines what a valid card file is. Zod 4 schemas are the single source; JSON Schema (for agents/skill) is generated from them; types are inferred. `validateCardFile(text)` returns `ok` or `broken` and is the only validation entry point for server (02), CLI `validate` (06) and tests. Contract-level validity = parse + schema + format checks; anything depending on "now" or on state is runtime (02).

## Problem
Agents write cards freehand. Without a precise, machine-checkable contract, 02/03/04/06 each guess shapes, and bad files either crash the UI or silently vanish (violates D9, D19).

## Goals / Non-Goals
Goals: exact envelope + data shapes with examples; one validator; stable formats; forward-compatible; cross-platform-safe ids.
Non-Goals: runtime state (visibility, stale, Done, Now — 02); rendering (03/04); archive/retention enforcement (02); a `write` CLI, Push API, embed/video types, UI inputs (futures.md); any TickTick access (agent-side only; dashboard never queries or calls TickTick, owner decision 2026-10-05).

## Requirements

### Envelope (D5, D9, §4)
| Field | Req | Type / default | Rule |
|---|---|---|---|
| `id` | yes | string | `^[a-z0-9][a-z0-9._-]{0,63}$`; lowercase only (case-insensitive FS safe); no `/ \ :` or spaces; not a Windows reserved name (`con`, `prn`, `aux`, `nul`, `com1-9`, `lpt1-9`, with or without extension); no trailing `.`. Should equal filename stem (mismatch = Broken, see below) |
| `kind` | yes | `"panel"\|"alert"` | |
| `type` | yes | `markdown\|table\|list\|kpi\|media` | Unknown string = Broken "unknown type" (forward-compat: server tolerates, never crashes) |
| `title` | yes | non-empty string ≤200 | |
| `updatedAt` | yes | RFC 3339 / ISO 8601 with offset or `Z` | Change resets Done (D14). Agent-authored, not file mtime |
| `priority` | no | integer 0–5, default 2 | ≤1 collapses (D22); Now threshold in config (02 owns; default 3, [RESOLVED] owner 2026-10-05) |
| `notify` | no | bool, default false | |
| `show` | no | `{cron: string, for?: duration}` | See formats. `for` omitted = window lasts until the end of that local day (owner 2026-10-05). **Cards without `show` are always visible** (no window; never hidden by time). |
| `staleAfter` | no | duration | Format validated here; enforcement = 02 |
| `retention` | no | duration | Archive only |
| `size` | no | `S\|M\|L`, default `M` | Hint |
| `error` | no | string\|null, default null | Non-empty string = Broken (D19). Empty string normalized to null |
| `data` | yes* | per-type object | *May be omitted/ignored when `error` is set non-null, so an agent can write a failure card without data |

Additional properties allowed everywhere (envelope, `data`, rows, items, cells' objects, D9): validator preserves them untouched in `card`, never rejects or strips. Reserved for future: any key starting `x-` is guaranteed never to be used by the contract.

### Expandable format (general principle)
Types are generic, not domain-specific. Agents add columns, fields and extra per-item/per-row keys freely and never need a new schema or type: unknown keys are preserved (and rewritten untouched by the server write-back, 02), table columns are free-form, any table cell can carry its own link, list items can carry secondary links. A new schema is needed only for a genuinely new visual (D7). Example: an email table adds a second link per row by adding a cell `{text:"Unsubscribe", link:"https://..."}` next to the row-level "open email" `link`; a TickTick list item carries `ticktick:{taskId,projectId}` as an agent-private extra.

### Alerts
`kind=alert` valid types: `markdown`, `list`, `kpi` (compact strip items). `table`/`media` on an alert = schema-invalid. Alerts honor `show` like panels: an alert with `show` only appears inside its window (no `show` = always; [RESOLVED] owner 2026-10-05); `size` ignored for alerts.

### Per-type `data` (all `link` = see Link rules)
| Type | Required | Optional | Notes |
|---|---|---|---|
| `markdown` | `text` (string ≤100k) | — | CommonMark + GFM; raw HTML not rendered (04: sanitize) |
| `table` | `columns: string[]` (1–50), `rows: {cells: Cell[], link?}[]` | `columns` may also be `{key?,label,sort?: "text"\|"number"\|"date"}` objects (free-form: agents choose any columns); `defaultSort?: {column: int, dir}`; `searchable?: bool` (default true) | `Cell = string\|number\|boolean\|null\|{text: string\|number\|boolean\|null, link?: Link}` (cell-level link; `text` is what is displayed, searched and sorted; `cellText(cell)` helper exported). Row-level `link` stays and coexists with cell links. `cells.length` must equal `columns.length` (else Broken). Search = substring over `String(cellText(cell))`; sort type inferred (number→numeric, ISO date→date, else text) unless `sort` given; filter = per-column value match, derived by 04 from cells (no filter schema needed) |
| `list` | `items: ListItem[]`, `ListItem = {text, id?, subtitle?, checked?, checkedAt?, due?, link?, links?, action?}` | `emptyText` | Checkbox shown iff `action` present. `id` required when `action` present (unique within card). `checked?` bool, `checkedAt?` ISO timestamp: see Actions. `due?` = ISO date `YYYY-MM-DD` (calendar day in `config.timezone`) or RFC 3339 datetime with offset; 04 shows relative/overdue. `links?: {text, link}[]` (<=5) = secondary links beside the main `link` (e.g. "Unsubscribe"). Agent chooses which tasks to list (only the important ones); the dashboard never queries any task system |
| `kpi` | `items: KpiMetric[]` (1–12) | — | `KpiMetric = {value: string\|number, label?, unit?, state?: "ok"\|"pending"\|"fail"\|"warn", trend?: {delta: number, dir?: "up"\|"down"\|"flat", good?: "up"\|"down"}, link?}`. State renders ✅/⏳/❌/⚠ ; `value` may be text ("Deployed"). **Single shape**: canonical = `items`; the flat single-metric form (`value`, `label`, ... at top level of `data`) is accepted shorthand and normalized by the validator to `items:[{...}]` (like `dismiss`), so 04 only ever sees `items`. Both forms present = schema-invalid. [RESOLVED: several metrics per card, owner 2026-10-05] |
| `media` | `items: {src, alt?, caption?, link?}[]` (1–50) | `layout?: "grid"\|"single"` | `src` = `http(s)` URL or `data:image/*` only (no `file:`, no local image files in v1: [DEFERRED] owner 2026-10-05); GIFs = image. Video src rejected (futures) |

**Actions.** `action` shape: `{ "type": "dismiss" }` or `{ "type": "complete" }` (fixed set, D8; unknown type = schema-invalid; shorthand strings `"dismiss"`/`"complete"` accepted and normalized). Both need `item.id`.
- `dismiss` = local tick kept in dashboard state (02 `state.json`), file untouched, one-way.
- `complete` = **write-back action** (owner decision 2026-10-05, supersedes D18's TickTick MCP client): ticking makes the server write the state into the card file itself: item gets `checked: true` and `checkedAt` (ISO timestamp with offset) (02 owns the atomic write). Unticking sets `checked: false` and removes `checkedAt`. `updatedAt` is never touched by the server. The card file is the hand-off: the owning agent reads it on its next run, acts on items with `checked: true` (e.g. completes the TickTick task via its own MCP access, using agent-private extras such as `ticktick: {taskId, projectId}` on the item; extras are preserved), then rewrites the card (new `updatedAt`). The contract knows nothing about TickTick.
- `checked`/`checkedAt` semantics: `checked` = current state (initial value if agent-authored); `checkedAt` is set by the server on tick (agents may also set it); `checkedAt` without `checked:true` is ignored. `checked:false` and absent are equivalent.

Link rules: **every agent-provided link is clickable** (row `link`, cell `link`, item `link`, item `links[]`, kpi `link`, media `link`, markdown links). A `Link` is a URL string ≤2048; allowed schemes `http`, `https`, `mailto`, `ms-outlook` ([RESOLVED] owner 2026-10-05). `javascript:`, `data:` (for links), `file:` and any other scheme are rejected (contract-level security; 03 `CardLink` re-checks, 04 adds `rel=noopener`). `data:image/*` stays valid only as media/markdown image `src`.

### Formats
- **Duration**: `^[1-9]\d*(m|h|d|w)$` (`30m`,`12h`,`26h`,`7d`,`2w`); no compound, no seconds, max 3650d. Helper `parseDuration → ms`.
- **Cron** (`show.cron`): standard 5-field, parsed with **croner** (same lib/dialect as sibling crontick; `@daily`-style aliases and 6-field seconds rejected). Evaluated in `config.timezone` (02), default server local timezone; `show.cron` = window start, `for` = length. Validator checks parseability only. Helper `windowActive(show, now, opts?: {timezone?: string})` lives here so 02 and tests share one implementation (02 calls it with `config.timezone`); `show.for` omitted = until end of that local day (implemented here in the helper). No `show.tz` field in the contract (timezone = 02 `config.timezone` only).
- **Timestamps**: `updatedAt` must parse and include offset/`Z`; naive local times = schema-invalid. Future skew > 5 min: valid, 02 may warn.
- **Priority**: integer 0–5.
- **List `due`**: `YYYY-MM-DD` or RFC 3339 with offset/`Z`; anything else = schema-invalid.

### Broken at contract level vs runtime
| Contract-level (validator returns `broken`) | Runtime (02) |
|---|---|
| Not UTF-8 / not JSON / not an object / empty file / > 1 MB | `staleAfter` exceeded |
| Missing/invalid required envelope field, bad `id`, id ≠ filename stem | `error` non-null (validator returns `ok`, with `card.error`; 02 renders Broken) |
| Unknown `type`, kind/type pair invalid, `data` fails type schema, bad duration/cron/timestamp/link/action | Outside `show` window (hidden, not Broken) |
Rationale: `error` card is a valid card carrying an agent-declared failure; the validator only reports malformed files. A broken file that has a parseable `id` yields `broken.id` so 02 can show a Broken card in place (not drop it); no id → listed by filename.

## Architecture
```
src/contract/
  envelope.ts  types/{markdown,table,list,kpi,media}.ts  formats.ts  registry.ts  validate.ts  index.ts
schemas/*.json        (generated, committed; envelope.json + one per type + card.json)
templates/<type>.example.json   (one realistic card per type; valid-by-test)
```
- **Source of truth**: Zod 4 (sibling crontick uses zod 4); TS types via `z.infer`; JSON Schema via `z.toJSONSchema` in `gen-schemas.ts`. CI test regenerates and diffs `schemas/` (stale = fail). Chosen over hand-written JSON Schema + ajv (two sources → drift; ajv only adds a dep). Fallback if Zod JSON-Schema output proves lossy for refine-based rules: note them in schema `description`.
- **Registry**: `registry.ts` maps `type → {schema, example, allowedKinds}`; the single place a type is registered (D7). UI registry (03) keys off the same type names.
- **Validator API** (exposed to 02, 06):
```ts
type ValidationResult =
  | { ok: true; card: Card; warnings: string[] }
  | { broken: true; reason: BrokenReason; message: string; issues: {path: string; message: string}[]; id?: string };
type BrokenReason = 'unreadable' | 'malformed-json' | 'not-object' | 'too-large' | 'schema-invalid' | 'unknown-type' | 'id-mismatch';
validateCardFile(text: string, opts?: { filename?: string }): ValidationResult
```
Never throws. `message` is human-readable one-liner shown in the Broken card; `issues` has JSON-pointer paths (CLI prints them). Also exports `parseDuration`, `windowActive`, `listTypes()`, `getExample(type)`, `Card` types.
- **Shipping** (06): npm `files` includes `dist/`, `schemas/`, `templates/`; contract compiled into the server/CLI bundles by tsup. `templates` command lists `registry` types + example paths; SKILL.md links `schemas/` and `templates/` relative to package root (resolved by `info`/`templates`, 06).
- **Adding a type (D7)**: (1) `src/contract/types/<t>.ts` schema, (2) `templates/<t>.example.json`, (3) register in `registry.ts`, (4) run `gen-schemas`, (5) UI component registered in 03's hook (04). Test fails if a registered type lacks example/component name.
- **Consumes**: nothing. **Provides**: validator + types + helpers (02, 06 CLI, 04 types), JSON Schema + examples (06 skill/templates), `Card` types (03).

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| C1 | Schema source | Zod 4 → generated JSON Schema, inferred TS types | Hand JSON Schema + ajv; json-schema-to-ts | One source, matches crontick; D9 JSON Schema still delivered |
| C2 | Extras | Allowed + preserved everywhere; `x-` reserved | Strip; strict | D9; agents store notes |
| C3 | Cron lib | croner, 5-field | node-cron, cron-parser | Parity with crontick |
| C4 | Ids | lowercase slug, Windows-reserved blocked, must match filename | Free text; slugify on server | Filename/archive-dir safe on all OSes; silent rewrite surprises agents |
| C5 | Duration | single unit m/h/d/w | ISO-8601 `PT12H`; compound | Brief examples; trivial for LLMs |
| C6 | Unknown type | Broken, not crash | Ignore card | D9/D19 visible failures |
| C7 | `error` is not a validation failure | ok + `card.error` | broken | Keeps valid-file vs agent-declared-failure distinct |

## Risks / Open Questions
- [RESOLVED: lowercase-only ids accepted (owner 2026-10-05)] was OPEN-1.
- [RESOLVED: TickTick MCP client dropped (owner superseded D18 2026-10-05); `complete` is a generic write-back action, TickTick ids are agent-private extras] was OPEN-2.
- [RESOLVED: `show.for` omitted = until end of that local day; no `show` = always visible (owner 2026-10-05)] was OPEN-3.
- [RESOLVED: alerts honor `show` (owner 2026-10-05)] was OPEN-4.
- [RESOLVED: kpi `items: KpiMetric[]`, flat single form normalized to items (owner 2026-10-05)] was OPEN-5.
- [RESOLVED: `ms-outlook` allowlisted with http/https/mailto; 03/04 `CardLink` follows (owner 2026-10-05)] was OPEN-6.
- [RESOLVED: Now threshold default 3 (owner 2026-10-05); 02 owns the config key] was OPEN-7.
- [RESOLVED: cell-level `link` (Cell object), list `links[]`, list `due` added to schema (owner 2026-10-05)].
- [DEFERRED] Local image files (media = http(s)/`data:image` only in v1).
- [OPEN-8] Untick of a `complete` item after the agent already completed it in TickTick only changes the file; agent's next rewrite is authoritative. Recommendation: allow untick (as specced); skill tells agents to rewrite the whole card each run.
- [RESOLVED: 02 adopts `validateCardFile(text,{filename})` and its `ValidationResult`; no `validateCardText`/`partial`; `broken.id` replaces `partial.id`] validator API.
- [RESOLVED: 02 passes filename and handles `id-mismatch` as a Broken card keyed `file:<name>`] id vs filename.
- [RESOLVED: list `checked` = item.checked (data) union snapshot `checked` ids (server-confirmed) union optimistic; 02/03/04 aligned] .
- [RESOLVED: alerts limited to markdown/list/kpi; 04 `allowedModes` on table/media, 03 registry honors it] .
- [RESOLVED: no `show.tz`; 02 `config.timezone`] .
- [RESOLVED: no schema versioning field in v1] forward-compat via additional-properties + `x-` reservation; add optional `schema` field later if needed.
- [DEFERRED] Per-type `data` size limits beyond 1 MB file cap; timezone field on `show`.

## Acceptance Criteria
- Each of the 5 `templates/*.example.json` validates `ok`; each has a negative fixture per rule (missing field, bad id incl. `CON`, `A/b`, uppercase; bad duration `7 days`; 6-field cron; naive timestamp; table row/column length mismatch; unknown action; `javascript:` link; table on alert).
- Truncated JSON → `broken/malformed-json`; `[]` → `not-object`; unknown `type` → `unknown-type` with `id` populated.
- Card with extra envelope and data keys → `ok`, extras present in output (also extras on rows, items, kpi metrics).
- kpi: `items` form ok; flat form normalizes to `items` of length 1; both forms present → schema-invalid. Table: cell `{text,link}` ok, `cellText` used for search/sort; cell link `javascript:` → broken. List: `due` date/datetime ok, `due:"tomorrow"` → broken; `links[]` ok; `complete` action without `item.id` → broken; `{type:"ticktick.complete"}` → broken. Links: `ms-outlook:` ok, `mailto:` ok, `data:`/`file:`/`ftp:` broken.
- Card without `show` has no window; alert with `show` validates ok.
- `error:"x"` card → `ok` with `card.error==="x"`; `staleAfter` never evaluated by validator.
- `gen-schemas` output equals committed `schemas/`; CI diff test passes; schemas load in a stock JSON Schema validator (spot check) and accept all examples.
- `validateCardFile` never throws on fuzzed input (binary, empty, 5 MB).
- Importable from server and CLI bundles with no Node-only/DOM dependencies.
