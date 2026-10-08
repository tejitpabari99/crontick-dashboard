---
status: draft
summary: CLI (`new`, folder/alert `validate`, folder `templates`), rewritten Claude skill, doc sweep, futures backlog and the final "skill builds an email-summary card" acceptance test.
date: 2026-10-08
---
# PRD: CLI, skill and docs (SP04)
Repo/branch: crontick-dashboard / `initial-brainstorming` · Depends on: SP01 (validators, data-path check, result shapes, registry, schemas/templates), SP02 (shared `readCardFolder`, feed layout, snapshot) · Owns: `src/cli/**`, `src/skill/SKILL.md`, `src/schemas-sync.ts` (new), `tests/cli/**`, `tests/skill/**`, acceptance test, `docs/**` (except SP01's errors.md reason tables), `README.md`, `docs/agent_files/futures.md`, `.changeset/*`

## TL;DR
Make the folder model usable: `new` scaffolds a card folder (card.json only, so the card shows "No data yet" until the agent's single data.json write); `validate` takes a folder, an alert file, or stdin with `--as`; `templates` prints folder examples. SKILL.md teaches: `new` once, then only rewrite data.json. Docs drop archive/retention/size/drag and describe folders, columns, the collapsed chip, lines, and the Completed section with its All/Alerts/Cards filter. Done = a scripted acceptance test that follows SKILL.md to build the email-summary `table` card and checks it validates and lands in the snapshot, plus an owner-run real-Claude check.

## Problem
CLI/skill/docs describe the v0.1.0 single-file envelope (`kind`, `size`, `retention`, id = filename, `validateCardFile`). Without `new` and two-file-aware `validate`, agents will make the mistakes the brief fears (wrong folder, wrong `$schema`, stray `.tmp`, id typos). The brief's riskiest assumption ("two files is too much friction") is only testable here.

## Goals / Non-Goals
Goals: one-command scaffold; validation of exactly what the server will load; skill that needs no schema knowledge from memory; docs consistent and non-duplicating; testable acceptance.
Non-goals: server/ingest/snapshot (SP02), contract (SP01), UI (SP03), `new-alert` command (alerts are one-line files; skill writes them directly), editing existing cards from the CLI, interactive prompts, YAML.

## Requirements

### CLI
`new <id> --type <t> [--title <s>] [--column left|center|right] [--order <n>] [--height S|M|L|auto] [--priority 0-5] [--force] [--json]`
- Id checked with `isCardFolderName`: `reserved` (`alerts`), `invalid`, `ignore` (dot-prefixed) all exit 2. Unknown `--type`: exit 2 (`UNKNOWN_TYPE`). Bad layout values: exit 2 (`INVALID_OPTION`, new code).
- Writes `<feed>/<id>/card.json` only: `{ "$schema": "../../schemas/card-def.json", type, title, layout? (only flags given), priority? }`; title default = id, dashes to spaces, capitalised. No data.json by default (agent supplies it; card shows muted "No data yet"). `--with-example` also writes the type's example data.json (humans trying the dashboard). Text is built from `getExample(type).card` overridden by flags, then run through `parseCardDef`; a self-check failure is a bug, not user error.
- Exists: exit 1 (`CARD_EXISTS`). `--force` rewrites card.json only (tmp + rename), never touches data.json or other files.
- Atomic create: build in `<feed>/.new-<id>-<rand>/` (dot-prefixed, ignored by ingest), then `rename` to `<feed>/<id>/`, so the watcher never sees an empty folder (`card-def-missing` flicker).
- Works with the server stopped: uses `ensureDirs` (creates `feed/` and `feed/alerts/` only; `new` never creates `archive/`), then `syncSchemas(env)`.
- Output: `created <dir>`, then `next: write <dir>/data.json (example: crontick-dashboard templates <type>)`. `--json` prints `{ id, dir, cardPath, dataPath, schemasSynced }`.

`validate [--json] [--as card|data|alert] [--type <t>] <path...>` (`-` = stdin)
- Directory: card folder. Same `readCardFolder(dir)` as the server (SP02, `src/feed/`; includes the SP01 data-path check and realpath containment), then `validateCardFolder`. `<path>/card.json` or `data.json`: validates the containing folder. Any other `.json` file: alert file (`validateAlertFile`; id = file stem).
- Stdin: `--as` required (exit 2 otherwise, one document per call). `alert`: alert text. `card`: card.json text through `parseCardDef` (id from `--id`, default `stdin`). `data --type <t>`: data.json text checked against the type via a synthetic card def (so agents validate a data.json before writing it; the skill also has them run `validate <folder>` after writing). Id/layout rules for the folder name are not checked on stdin; `new` covers that.
- Text: `OK <id> (<type>)` + warnings; `NO DATA <id>` (valid, exit 0, note "write data.json"); `BROKEN <reason>: <msg>` + issue lines; `SKIPPED <reason>: <msg>`. `--json`: array of `{ path, result }` with the SP01 result verbatim. Exit 0 ok/no-data, 1 any broken/skipped, 2 unreadable.

`templates [type] [--schema [card|data|payload]] [--file card|data] [--path]`
- No arg: `TYPE  SUMMARY  FOLDER` (5 types + `alert`); `KINDS` column removed.
- `<type>`: prints `# card.json` and `# data.json` blocks (alert: one block). `--file` prints one raw file (pipe-friendly). `--schema` prints `data.<type>.json` (default `data`), `card` = `card-def.json`, `payload` = bare `<type>.json`; `alert` has `alert.json`. `--path`: folder path + schema paths.
- Examples read from packaged `templates/`; same files SP01 embeds (test asserts equality).

`info --json`: field set unchanged (frozen contract) plus nothing new; `schemasDir` still the packaged one.

### Schema sync (`src/schemas-sync.ts`)
`syncSchemas(env, assets)` copies packaged `schemas/*.json` into `<data>/schemas/` (overwrite only if content differs, delete nothing, failure = warning not error). Called by `new` and by server/daemon start: SP04 writes `syncSchemas`; SP02 adds the one call in server startup. Rationale: `$schema` is `../../schemas/<file>` (SP01 #7), so both paths must exist before an editor opens a card; `new` covers CLI-first use, start covers hand-written cards and upgrades.

### Skill (`src/skill/SKILL.md`, install.ts unchanged)
Sections: 1 purpose + `info --json` feedDir; 2 folder model (card.json = view, data.json = content, ids = folder names, `alerts` reserved; `data` is a plain file name inside the card folder: no subfolders, no symlinks leading outside) with a small field table pointing to `templates` for exact shapes; 3 first time: `new <id> --type <t> [layout flags]`, then `templates <t> --file data` as the shape to write; 4 each run: build data.json, pre-validate via `validate - --as data --type <t>`, write `data.json.tmp` then rename (ingest ignores dot-files and `*.tmp`), then run `validate <folder>`; 5 `updatedAt`: set only when content truly changed, otherwise rewrite nothing (mtime fallback re-notifies no-op rewrites); 6 layout fields + heights; 7 priority/`show`/`staleAfter`/`notify` (card.json, edit once); 8 failure: `error` in data.json; 9 alerts: `feed/alerts/<id>.json`: `title` required, `text` optional (one line, ≤200 chars), `link?` (clickable); a ticked alert moves to Completed in the UI; 10 list-item ticks: read data.json first; 11 extending/gotchas. Removed: `kind`, `size`, `retention`, id=filename, Done tray/archive. Keep trigger phrases, `allowed-tools: shell`, version comment. The email-summary worked example is the acceptance fixture (marked fenced blocks).

### Docs
| File | Change |
|---|---|
| concepts/cards-and-feed | folder model, card.json vs data.json ownership, "No data yet", skipped vs Broken, alerts dir; delete archive/retention; link to reference for fields |
| concepts/zones-and-layout | three columns, narrow stacking, heights, Now at top of center, collapsed chip/line renderings, no drag; **Completed section** (full width below columns, collapsible, Done cards + ticked alerts, newest first, 7-day/50 cap for alerts) and header filter All/Alerts/Cards; keep anti-crowding rules |
| concepts/card-types | per-type data unchanged; add "card.json picks type, data.json holds payload" |
| concepts/actions-and-state | state.json without layout; Done only on new data.json version; Done cards move to Completed (Reopen returns them; new data resets Done); `complete` writes data.json (pins `updatedAt` if absent); alerts have own ids (`alert:<id>`), tick moves file to `.done/`, listed in Completed with tick time, 7 days / max 50, files kept on disk, no un-tick in v1 |
| concepts/notifications | triggered by data.json versions / alert files; card.json edits silent |
| reference/card-schema | card.json, data.json, alert tables (`title` req, `text` optional); `data` path rule (plain file name in the card folder, no subfolders/symlinks out); `$schema` (relative, schemas in `<data>/schemas/`); removed fields; Completed/filter reference (snapshot `completed`, `completedAlertItems`) |
| reference/cli | sections above, exit codes, new error codes |
| reference/configuration | drop `retentionDefault`; mention `<data>/schemas/` |
| reference/errors | CLI codes + link to SP01 reason tables (SP01 owns table rows) |
| reference/glossary, library-api | card folder, alert, chip, line, slot, Completed, filter; new exports |
| implementation/{cli-and-skill, contract, feed-and-ingest, state, ui, http-server, build-and-package, README} | sweep for archive/retention/size/layout/drag/`react-grid-layout`; cli-and-skill gains `new`/`syncSchemas` wiring and stdin modes |
| architecture.md, docs/README.md, README.md, AGENTS.md source map, docs/testing | folder examples, `new` quickstart, source map (`feed/` no archive; `ui` no tray) |
| decisions/0002 | sweep: amend "Done chip in own slot" to the Completed section (Done cards and ticked alerts, header filter); check no other contradictions |
Concepts stay narrative and link to reference for field lists ("Non-duplication" headers retained). Verification: `grep -rniE 'archive|retention|react-grid|drag|size:|kind' docs README.md src/skill` leaves only history (`agent_files/`, ADR "superseded" notes).

### Futures (`docs/agent_files/futures.md`)
New "Layout and model" section: `span` (2-3 cards per row), page-level `dashboard.json`, multiple pages, configurable column widths, shared data files (several cards reading one file), data-optional types (e.g. calendar, via per-type registry flag), YAML input. Add "un-tick alerts from Completed". Move "History viewer" note: archive is gone, so reword to "needs a new archive design".

### Changeset
`.changeset/card-folders.md`, `minor` (0.x; `major` is blocked by `check:changesets`), body stating BREAKING: panels are folders, new alert files, `new` command, removed `size`/`retention`/archive/layout drag, `validateCardFile` removed.

### Tests
- `tests/cli/new.test.ts`: scaffold content, `$schema`, flags to layout, reserved/invalid/dot ids, exists vs `--force` (data.json untouched), atomic temp dir leaves nothing, `--with-example`, schemas synced.
- `tests/cli/validate.test.ts` (rewrite): folder ok/no-data/broken/skipped, card.json path arg, alert file, stdin `--as` modes, `--json`, exit codes.
- `tests/cli/templates.test.ts` (rewrite), `readme.test.ts` (README commands exist), `schemas-sync.test.ts`.
- `tests/skill/skill-md.test.ts`: every command named exists in `--help`; every `templates <x>` is a type or `alert`; every marked JSON block in SKILL.md validates through the SP01 validators (alert example without `text` included); no mention of `kind`/`size`/`retention`/`archive`.

### Acceptance (final)
`tests/skill/acceptance.test.ts` (vitest, in-process, temp `ENV_HOME`): follows SKILL.md literally: `info --json` feedDir; `run(['new','email-summary','--type','table','--title','Email summary','--column','center','--height','M'])`; stdin-validate the SKILL.md email data block; atomic write of `data.json`; `validate <folder>` exit 0 with no warnings; then `startServer` (FakeNotifyAdapter) and assert `/api/snapshot` has the card in the center column, status ok, rows present. Before the data write: snapshot shows "no data" state. Add one case to `tests/smoke/smoke.spec.ts` (SP03 owns the fixture rewrite; here: this card renders its table). This proves the tooling path deterministically; it does not prove an LLM follows the skill, hence the manual step.

## Architecture
```
agent ─ `new` ─► <data>/feed/<id>/card.json (+ <data>/schemas/ synced)
agent ─ validate - --as data ─► SP01 validators        agent ─ writes data.json (tmp+rename)
CLI validate <dir|file> ─► shared folder reader (SP02) ─► validateCardFolder / validateAlertFile
```
CLI stays a thin adapter: pure SP01 validators, SP02 reader, `paths.ts`, injected `CliIo`. New code: `commands/new.ts`, `schemas-sync.ts`, rewrites of `validate.ts`/`templates.ts`; `main.ts` COMMANDS gains `registerNew`.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | What `new` writes | card.json only; `--with-example` opt-in | Always write example data.json | An example would show fake data as real; absent data gives honest "No data yet" and proves the one-write flow |
| 2 | Re-run on existing id | Error; `--force` = card.json only | Silent overwrite; merge | Never clobber agent data |
| 3 | Create atomicity | Temp dot-dir + rename | Write in place | No empty-folder warning flicker |
| 4 | Stdin | `--as card\|data\|alert` required, one doc | Auto-detect; multi-doc | Two-file model makes guessing wrong; agents validate data.json pre-write |
| 5 | Path dispatch | dir = card; card.json/data.json = its folder; other json = alert | `--alert` flag | Matches on-disk layout, no flags |
| 6 | Schema copy | `new` + server/daemon start | Only one | Both entry points exist; sync is idempotent |
| 7 | `new` for alerts | None | `new-alert` | One-liners; file is shorter than the command |
| 8 | `templates` | Folder output, `--file`, `--schema [which]` | Single combined JSON | Raw files stay copy-pasteable |
| 9 | Acceptance | Scripted skill-following test + manual Claude run | Manual only | Deterministic CI check; LLM check stays owner-run |
| 10 | Changeset level | `minor` | `major` | `check:changesets` blocks major; 0.x |
| 11 | Reader | One `readCardFolder(dir)` in SP02 (`src/feed/`), CLI reuses it | CLI-owned copy | CLI = server by construction |
| 12 | Schema sync hook | SP04 writes `syncSchemas`; SP02 calls it at server startup | SP04 edits server lifecycle | Clear ownership |
| 13 | Skill validation | Pre-write `validate - --as data --type <t>` and post-write `validate <folder>` | Folder-only | Cheap pre-check plus the exact server view |
| 14 | Alert docs/skill | `title` req, `text` optional, `link` clickable; Completed lists ticks 7 d / 50 | Both required | Owner 2026-10-08 |

## Manual steps
Owner, once SP01-SP03 merged: (1) `crontick-dashboard skill install --force` into a scratch skills dir; (2) with `CRONTICK_DASHBOARD_HOME=<tmp>` start the dashboard; (3) in a fresh Claude session with only that skill ask: "Summarise my unread email onto my dashboard as a table (invent 5 messages)"; (4) pass if: it ran `new` then wrote one data.json, `validate <folder>` exits 0, and the card renders as a table in the center column. Record result and transcript path in the run record. Failure = brief's fallback (merge files or improve skill).

## Risks / Open Questions
- [RESOLVED: owner 2026-10-08 — one shared `readCardFolder(dir)` lives in SP02 (`src/feed/`); the CLI reuses it] Shared folder reader.
- [RESOLVED: owner 2026-10-08 — ingest ignores files starting with `.` or ending `.tmp` in card folders and `feed/alerts/` (except `feed/alerts/.done/`, read for Completed); SP02 covers it] Atomic-write ignore rule.
- [RESOLVED: owner 2026-10-08 — SP02 no longer creates `archive/` at startup; `new` must not recreate it] `ensureDirs` and `archive/`.
- [RESOLVED: owner 2026-10-08 — SP04 writes `syncSchemas`; the server calls it at startup (SP02 adds the call)] Schema sync hook ownership.
- [RESOLVED: owner 2026-10-08 — `validate` checks data.json from stdin via `--as data --type <t>`; the skill also tells agents to run `validate <folder>` after writing] Skill pre-validation.
- [DEFERRED] `new-alert`, `new --from <folder>` copy, editing commands.
- [RESOLVED: owner 2026-10-08] `$schema` = relative `../../schemas/<file>`, schemas copied into `<data>/schemas/` by SP04 (relative is intentional: editors resolve relative to the file; survives moving the data dir).
- Risk: skill compliance with "don't rewrite unchanged data" is unenforceable; surfaced by `updatedAtSource: mtime` warning in `validate`? (decided no warning; revisit after manual run).

## Acceptance Criteria
- `npm run validate` green; new/rewritten CLI, skill and acceptance tests pass; `npm run verify-package-install` exercises `new` then `validate` from the packed tarball.
- `crontick-dashboard new email-summary --type table` then one data.json write yields `validate` exit 0 and a rendered table card; manual Claude run recorded.
- Docs describe the Completed section, All/Alerts/Cards filter, Done cards moving to Completed, alert tick time, 7-day/50 cap; skill and docs state `data` is a plain file name in the card folder and alert `text` is optional; ADR 0002 has no "Done chip in own slot" left.
- `grep` sweep (above) clean outside history; every doc keeps its Non-duplication header and no concept restates reference tables.
- futures.md has the seven items plus "un-tick alerts from Completed"; changeset present; no `validateCardFile`, `kind` column, or `KINDS` left in `src/cli`, `src/skill`.
