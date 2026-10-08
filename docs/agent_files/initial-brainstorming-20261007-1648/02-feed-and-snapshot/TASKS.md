---
status: draft
summary: SP02 dev spec — 11 tasks: archive/layout removal, state, shared reader, folder+alert ingest, watcher, column snapshot, mutations, write-back, notifications, acceptance sweep.
date: 2026-10-08
---
# Tasks: Feed ingest and snapshot (SP02)
Source of truth: docs/agent_files/initial-brainstorming-20261007-1648/02-feed-and-snapshot/PRD.md. Server side of card folders, built on SP01 validators. Each task updates its own tests under `tests/server/**` and aims to leave `npm run validate` green; UI breakage from DTO/route removal is resolved by SP03.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Remove archive, retention and layout surface | - | done |
| 2 | State: doneAt, no layout, alert key prefix | 1 | done |
| 3 | Shared `readCardFolder` reader | SP01 | done |
| 4 | Card-folder ingest core | 2, 3, SP01 | done |
| 5 | Alert and completed-alert ingest | 4 | done |
| 6 | Recursive watcher and rescan | 4, 5 | done |
| 7 | Column snapshot and DTO | 2, 4, 5 | done |
| 8 | Mutations, actions, startup wiring | 5, 7 | done |
| 9 | `complete` write-back pins updatedAt | 4 | done |
| 10 | Events and notifier view payload | 4, 5 | done |
| 11 | Test sweep and acceptance check | 1-10 | done |

## Task 1 — Remove archive, retention and layout surface
What it is / what it means: Delete the archive seam and the user-arranged layout concept (Decisions on archive removal; Requirements "Archive removal", "Mutations").
What changes at a high level: Archive module and its test go; `onIngest`/`IngestInfo`, archive wiring in the server, `archiveDir`, archive and retention constants, `retentionDefault` config field and parse branch go. `PUT /api/layout`, its schema and error code go. `ensureDirs` no longer creates `archive/`. Old config keys and leftover `archive/` dirs are ignored silently. SP01 owns removing `retention` from the envelope.
Done when: grep for archive/retention/layout symbols in src and tests is clean (AC8 grep part, AC11 ensureDirs); old config with `retentionDefault` loads without warning.

## Task 2 — State: doneAt, no layout, alert key prefix
What it is / what it means: State changes needed by snapshot and Completed (Requirements "State"; Decisions 8, 12).
What changes at a high level: Add `doneAt` map, set with Done, cleared on reopen and whenever reconcile drops a mismatching ack, pruned like `acks`. Drop `layout` from schema, defaults, snapshot/restore and `setLayout`; old state files load and lose the key at next write. Prune present-set gains `alert:<id>` keys and ids of cards with broken data. Prune and reconcile rules otherwise unchanged.
Done when: state tests cover doneAt lifecycle, old-state-with-layout load, alert-prefix keys surviving prune.

## Task 3 — Shared `readCardFolder` reader
What it is / what it means: One fs adapter so server and CLI resolve folders identically (Decisions 18, 19). Requires SP01 `parseCardDef`.
What changes at a high level: New reader that reads card.json, parses it for the data path, reads the data file with realpath containment (symlink escape becomes `data-path-invalid`), collects mtimes, and returns the inputs for SP01 `validateCardFolder`. Exported for SP04's CLI.
Done when: unit tests cover absent, unreadable, plain, and symlink-escaping data files; reader is exported.

## Task 4 — Card-folder ingest core
What it is / what it means: Replace flat per-file ingest with per-folder evaluation (Requirements "Ingest" table, "New-content semantics"; Decisions 3, 4, 10).
What changes at a high level: Sync-core `processFolder` using the reader and SP01 validation, keeping timer injection. Cards keyed by folder name; `alerts` name reserved. Handles no-data entries (staleAfter reference = card.json mtime), card.json invalid warnings, data-before-card ordering, malformed-data settling, 3 s missing-card.json warning, loose root file warnings, folder removal/rename. Entries carry viewHash, dataHash, dataVersion; `CardChange.contentChanged` added. An `issues()` list feeds warnings.
Done when: AC1, AC2 (ingest part), AC3 (entry), AC5 pass in ingest tests.

## Task 5 — Alert and completed-alert ingest
What it is / what it means: Alerts as separate stores with their own ids (Decisions 7, 14, 15, 21; Requirements "Ingest", "Store keys").
What changes at a high level: `processAlert` and `processCompletedAlert` using SP01 `validateAlertFile` (title required, text optional); broken alerts kept as tickable rows. Stores `alerts` (by stem) and `completedAlerts` (by `.done` stem, `tickedAt` = mtime). Invalid `.done` files skipped silently. Dot-prefixed and `.tmp` files ignored except the `.done` directory.
Done when: ingest tests show alert add/change/remove, `.done` pickup, silent bad `.done`, text-less alert loads (AC7 ingest part, AC10, AC11 ignore rules).

## Task 6 — Recursive watcher and rescan
What it is / what it means: Watch strategy (Decisions 1, 2, 20; Architecture).
What changes at a high level: One recursive `fs.watch` on `feed/`; event names map to folder, alert, or completed-alert keys; per-folder debounce (200 ms) with per-file settling; null filename or error triggers full rescan. 10 s rescan covers `feed/`, each folder, `alerts/` and `alerts/.done/`. Add a smoke test that creates a new subfolder and file after start.
Done when: AC12 smoke test passes locally; CI runs it on Linux, macOS, Windows.

## Task 7 — Column snapshot and DTO
What it is / what it means: Pure `computeSnapshot` and shared API types for SP03 (Requirements "Snapshot"; Decisions 6, 7, 9, 14, 16).
What changes at a high level: Replace zones/layout with `columns` id lists, `now`, `alerts`, `hidden`, `completed`, and ViewCard/ViewAlert/ViewCompletedAlert maps per the PRD DTO. Apply ordering rules: hidden, then Done, then Now, then column by order/id; defaults for column/height resolved server-side; low-priority collapsed; no-data cards slot without data; completed alerts limited to 7 days and 50; warnings passed in.
Done when: AC4, AC9 (snapshot part), AC10 (snapshot part) pass in compute tests.

## Task 8 — Mutations, actions, startup wiring
What it is / what it means: HTTP surface for the new model (Requirements "Mutations / actions / paths"; Decisions 9, 17).
What changes at a high level: Done sets `doneAt`, reopen clears it; hide is cards-only; alert tick moves the file into `feed/alerts/.done/` (collision suffix and EXDEV fallback kept), sets mtime via `utimes`, and stays idempotent. `refreshFeed` takes `{kind, id}`. `/actions` precondition uses effective `updatedAt`. Server startup calls SP04 `syncSchemas` once, logging non-fatal failures. No alert un-tick.
Done when: AC7 (tick), AC9 (reopen), AC10 (tick survives restart), AC11 (syncSchemas) pass. Requires SP04 `syncSchemas` (stub if not landed).

## Task 9 — `complete` write-back pins updatedAt
What it is / what it means: Prevent mtime fallback resetting Done/checks/notified (Requirements "Write-back"; Decision 11).
What changes at a high level: Write-back targets the resolved data path with temp file in the same folder and `selfWrites` keyed by folder/data.json; edits items in the parsed object so unknown fields survive; when `updatedAt` is absent, pins it to the prior effective value.
Done when: AC6 passes (no event, state intact, unknown fields kept).

## Task 10 — Events and notifier view payload
What it is / what it means: Notifications for panels and alerts (Requirements "Notifications"; Decisions 13, 22).
What changes at a high level: Events fire only on `contentChanged`, non-Broken, in window, and `updatedAt` differing from `notified`. Payload becomes the small view object. Alerts notify on hash change, deduped under `alert:<id>`; body is `text` else truncated `title`; panels use registry summary. `.done/` never notifies. Open URL `#card=<id>` for panels, `/` for alerts.
Done when: AC1 (one `card:new`), AC2 (notify once), AC7 (notify body), AC10 (never notifies) pass.

## Task 11 — Test sweep and acceptance check
What it is / what it means: Close the loop on PRD AC13.
What changes at a high level: Update remaining `tests/server/{ingest,compute,state,mutations,actions,events,done,paths-config,http,e2e}.test.ts`, confirm `archive.test.ts` is gone, walk AC1–AC13, update `AGENTS.md` source-organization lines and add a changeset plus ADR as repo conventions require.
Done when: `npm run validate` passes and AC8 grep returns nothing.

## Closing note
No manual (owner-only) steps in the PRD. No [OPEN] items; all risks are RESOLVED or DEFERRED. Cross-project: SP01 validators/`parseCardDef` and SP04 `syncSchemas` are external dependencies; SP03 must not expose hide for alerts.
