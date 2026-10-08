---
status: draft
summary: SP04 CLI, skill and docs — 9 tasks - syncSchemas, `new`, `validate`, `templates`, SKILL.md, acceptance test, concept/reference docs, doc sweep, futures and changeset.
date: 2026-10-08
---
# Tasks: CLI, skill and docs (SP04)
Source of truth: docs/agent_files/initial-brainstorming-20261007-1648/04-cli-skill-docs/PRD.md. All PRD items are RESOLVED or DEFERRED; no open questions block these tasks. Tests ship with each task; SP01 = contract, SP02 = feed/reader/snapshot, SP03 = UI.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | `syncSchemas` | SP01 schemas | done |
| 2 | `new` command | 1, SP01, SP02 | done |
| 3 | `validate` rewrite | SP01, SP02 | done |
| 4 | `templates` rewrite and CLI cleanup | SP01 | done |
| 5 | SKILL.md rewrite and skill tests | 2, 3, 4 | done |
| 6 | Acceptance test and smoke case | 5, SP02, SP03 | done |
| 7 | Concept and reference docs | 2, 3, 4, SP01, SP02, SP03 | done |
| 8 | Remaining docs sweep and ADR 0002 | 7 | done |
| 9 | Futures backlog and changeset | 5 | done |

## Task 1 — `syncSchemas`
What it is / what it means: the early helper SP02's server startup calls (Schema sync section; Decisions 6, 12).
What changes at a high level: add `src/schemas-sync.ts` exporting `syncSchemas(env, assets)`: copy packaged `schemas/*.json` into `<data>/schemas/`, overwrite only when content differs, never delete, failure is a warning not an error. Export it so SP02 can add its single startup call; SP04 does not touch server lifecycle.
Done when: `tests/cli/schemas-sync.test.ts` covers first copy, idempotent rerun, changed-content overwrite, no deletion, and unwritable dir producing a warning; `npm run validate` green.

## Task 2 — `new` command
What it is / what it means: one-command card scaffold (CLI `new` requirements; Decisions 1, 2, 3, 6, 7).
What changes at a high level: add `commands/new.ts` and register it in `main.ts`. Validate id via `isCardFolderName` (reserved/invalid/ignore exit 2), type, and layout flags (`INVALID_OPTION`, new code). Build card.json from `getExample(type).card` overridden by flags, self-check through `parseCardDef`, write in a dot-prefixed temp dir, rename into place. `CARD_EXISTS` exit 1; `--force` rewrites card.json only. `--with-example` adds data.json. Uses `ensureDirs` (no `archive/`) then `syncSchemas`. Text and `--json` output per PRD.
Done when: `tests/cli/new.test.ts` covers scaffold content, `$schema`, flags to layout, bad ids, exists vs `--force` (data.json untouched), atomic temp leaves nothing, `--with-example`, schemas synced; `npm run validate` green.

## Task 3 — `validate` rewrite
What it is / what it means: validate exactly what the server loads (CLI `validate` requirements; Decisions 4, 5, 11, 13).
What changes at a high level: rewrite `validate.ts`: directory or `card.json`/`data.json` path validates the folder via SP02's `readCardFolder` plus `validateCardFolder`; any other `.json` is an alert file via `validateAlertFile`. Stdin (`-`) requires `--as card|data|alert` (data needs `--type`, using a synthetic card def; card takes `--id`). Text outputs OK / NO DATA / BROKEN / SKIPPED, `--json` array of `{path, result}`, exit 0 ok/no-data, 1 broken/skipped, 2 unreadable. Remove `validateCardFile` use.
Done when: `tests/cli/validate.test.ts` (rewritten) covers folder ok/no-data/broken/skipped, path-arg dispatch, alert file, stdin modes and missing `--as`, `--json`, exit codes; `npm run validate` green.

## Task 4 — `templates` rewrite and CLI cleanup
What it is / what it means: folder-shaped template output (CLI `templates`, `info`; Decision 8).
What changes at a high level: rewrite `templates.ts`: no-arg table `TYPE SUMMARY FOLDER` (five types plus `alert`, no `KINDS`); `<type>` prints `# card.json` and `# data.json` blocks; `--file`, `--schema [card|data|payload]`, `--path`. Examples come from packaged `templates/`. Confirm `info --json` fields unchanged. Remove remaining `kind`/`KINDS`/`validateCardFile` references in `src/cli`.
Done when: `tests/cli/templates.test.ts` (rewritten) covers all modes and asserts equality with SP01's embedded examples; `readme.test.ts` updated to current commands; `npm run validate` green.

## Task 5 — SKILL.md rewrite and skill tests
What it is / what it means: the agent-facing skill teaching `new` once, then only rewrite data.json (Skill section; Decisions 13, 14).
What changes at a high level: rewrite `src/skill/SKILL.md` in the 11 sections from the PRD, keeping trigger phrases, `allowed-tools: shell` and the version comment; `install.ts` untouched. Include the email-summary table worked example as marked fenced blocks (card, data, alert without `text`). Remove `kind`, `size`, `retention`, id=filename, Done tray/archive. State that `data` is a plain file name and ticked alerts go to Completed. Add `tests/skill/skill-md.test.ts`: named commands exist in `--help`, `templates <x>` args valid, marked JSON blocks validate via SP01, banned words absent.
Done when: skill tests pass; `npm run validate` green.

## Task 6 — Acceptance test and smoke case
What it is / what it means: deterministic proof of the tooling path (Acceptance section; Decision 9; Acceptance Criteria).
What changes at a high level: add `tests/skill/acceptance.test.ts`: temp `ENV_HOME`, follow SKILL.md literally (`info --json`, `new email-summary ...`, stdin-validate the SKILL.md data block, snapshot shows "no data" before write, atomic data.json write, `validate <folder>` exit 0 with no warnings), then `startServer` with FakeNotifyAdapter and assert `/api/snapshot` has the card in center, status ok, rows present. Add one case to `tests/smoke/smoke.spec.ts` rendering this table (SP03 owns the fixture rewrite). Make `verify-package-install` run `new` then `validate` from the packed tarball.
Done when: acceptance test and package-install check pass; `npm run validate` green; smoke case passes where Playwright is available.

## Task 7 — Concept and reference docs
What it is / what it means: first half of the Docs table (concepts and reference rows).
What changes at a high level: update concepts (cards-and-feed, zones-and-layout incl. Completed section and All/Alerts/Cards filter, card-types, actions-and-state, notifications) and reference (card-schema, cli, configuration, errors CLI codes linking to SP01 tables, glossary, library-api). Drop archive/retention/size/drag and `retentionDefault`. Concepts stay narrative and link to reference; keep "Non-duplication" headers. SP01's errors.md reason tables are not edited.
Done when: each file matches the PRD table row; Completed cap (7 days/50), tick time and `data` path rule documented; `npm run validate` green.

## Task 8 — Remaining docs sweep and ADR 0002
What it is / what it means: second half of the Docs table plus the grep acceptance.
What changes at a high level: sweep `docs/implementation/*` (cli-and-skill gains `new`/`syncSchemas` wiring and stdin modes), architecture.md, docs/README.md, README.md (`new` quickstart, folder examples), AGENTS.md source map (`feed/` no archive, `ui` no tray), docs/testing, and amend ADR 0002 "Done chip in own slot" to the Completed section; check for other contradictions.
Done when: `grep -rniE 'archive|retention|react-grid|drag|size:|kind' docs README.md src/skill` leaves only history (`agent_files/`, ADR superseded notes); no concept restates reference tables; `npm run validate` green.

## Task 9 — Futures backlog and changeset
What it is / what it means: backlog and release bookkeeping (Futures, Changeset sections; Decision 10).
What changes at a high level: in `docs/agent_files/futures.md` add a "Layout and model" section with the seven items, add "un-tick alerts from Completed", and reword the History viewer note to "needs a new archive design". Add `.changeset/card-folders.md` at `minor` with a BREAKING body (folders, alert files, `new`, removed `size`/`retention`/archive/drag, `validateCardFile` removed).
Done when: `npm run check:changesets` passes; futures.md has all items; `npm run validate` green.

## Closing note
Owner-only manual step, after SP01-SP03 merge: run `crontick-dashboard skill install --force` into a scratch skills dir, start the dashboard with `CRONTICK_DASHBOARD_HOME=<tmp>`, and in a fresh Claude session with only that skill ask for an unread-email summary as a table. Pass if it ran `new`, wrote one data.json, `validate <folder>` exits 0 and the table renders in center. Record the result and transcript path in the run record. SP02 must add the `syncSchemas` startup call (Task 1 provides it).
