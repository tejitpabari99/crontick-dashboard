---
status: draft
summary: Server side of card folders — folder/alert ingest, shared card-folder reader, column snapshot with Now/no-data/alerts/Completed list, state without layout, archive removed, write-back into data.json, alert notifications.
date: 2026-10-08
---
# PRD: Feed ingest and snapshot (SP02)
Repo/branch: crontick-dashboard / `initial-brainstorming` · Depends on: SP01 (card-folder contract) · Owns: `src/feed/{ingest,watcher,done,events,read-card-folder}.ts`, `src/feed/archive.ts` (delete), `src/compute/snapshot.ts`, `src/state/store.ts`, `src/shared/api-types.ts`, `src/actions/*`, `src/http/{server,app,mutations,actions}.ts` (incl. the one startup call to SP04's `syncSchemas`), `src/paths.ts`, `src/config.ts`, `src/constants/{config,feed,error-codes}.ts`, `src/integrations/notify/notifier.ts`, `tests/server/**`

## TL;DR
Ingest reads `feed/<id>/{card.json,data.json}` and `feed/alerts/<id>.json`, delegates all validation to SP01, and keeps the existing sync-core + timer-injected watcher shape. `computeSnapshot` returns three ordered id lists (left/center/right), Now, alerts, a `completed` list (ticked alerts + Done cards) and flags (`collapsed`, `done`, `no-data`); the UI only draws. Done cards leave their column and Now and return on reopen or new content. Only a new data.json version is "new content" (resets Done, notifies). One shared `readCardFolder(dir)` reader serves ingest and the CLI. Archive, `retention`, `retentionDefault` and `layout` state are deleted. `complete` write-back edits data.json and pins `updatedAt` so it never counts as new content.

**SP01 API used (pure, no fs/clock):** `parseCardDef(folderId, cardText)` (gives the data path); `validateCardFolder({folderId, cardText, data: {text, mtimeMs} | {absent: true} | {unreadable}, now?})` → `ok | no-data | broken | skipped`; `validateAlertFile({name, text, mtimeMs, now?})` → `ok | broken` (title required, `text` optional); `isCardFolderName(name)`. The data-path check (single plain file name) lives in SP01; `readCardFolder` adds the fs-level `realpath` containment (symlink escape = `data-path-invalid`).

## Problem
Ingest is flat, one-file-per-card, keyed by `card.id` with duplicate-id logic, an archive seam, and a `feed/done/` dir that would now look like a card folder. Snapshot emits grid/tray zones plus `layout` from state. Write-back and events assume one file holds both view and content.
Evidence: `src/feed/ingest.ts` (flat `readdirSync`, `isFeedFile`), `src/compute/snapshot.ts:130` (`layout: state.layout`), `src/http/mutations.ts` (`/api/layout`), `src/paths.ts:33` (`doneDir`, `archiveDir`).

## Goals / Non-Goals
Goals: folder + alert ingest tolerant of partial writes and any write order; column snapshot as a pure function; remove archive/layout; correct new-content semantics; alert notifications.
Non-goals: validation rules (SP01), drawing (SP03), CLI/skill/docs (SP04), drag/resize, migration of v0.1.0 files or state.

## Requirements

### Ingest
| Case | Behaviour |
|---|---|
| Scope | `feed/*/` one level + `feed/alerts/*.json` + `feed/alerts/.done/*.json` (completed alerts, see Completed). Files starting with `.` or ending `.tmp` (write-back temps) are ignored inside card folders and `feed/alerts/`, except the `feed/alerts/.done/` directory itself |
| Loose file in `feed/` root | Ignored; one stable warning per name (`feed/<name> ignored: panels are folders (feed/<id>/card.json)`), cleared when removed. Covers leftover v0.1.0 files |
| `feed/alerts` | Never a card; reserved before any validation |
| Folder, no `card.json` | Not shown. Warning only after the settle window (3 s) so `mkdir` then write is silent; cleared when card.json appears |
| card.json invalid | Folder skipped + warning with SP01 message (keyed `feed:<id>`); malformed JSON enters settling first |
| data.json before card.json | Held; first card.json event processes the folder; arrives as `new` with data (notify fires once) |
| data.json missing | Entry `no-data` (shown, muted). `staleAfter` reference = card.json mtime (entry carries `viewMtimeMs`) |
| data.json malformed | Settling (250 ms / 1 s / 3 s, restart on mtime change) keeping the previous entry, then Broken with reason; as today |
| data path escapes | Broken folder (card.json invalid) via SP01 path check + `readCardFolder` realpath check |
| Folder removed/renamed | Entry removed (`card:removed`); rename = old id removed, new id `new`; old id's state ages out via existing 30-day prune |
| Two-file write | A folder is re-evaluated as a unit; a half-written either file keeps the previous entry until settled |

Store keys: panels by folder name (duplicates impossible), alerts under a separate `alerts` store keyed by file stem, completed alerts under `completedAlerts` keyed by `.done` file stem (value carries `tickedAt` = file mtime). Alerts have their own ids; state keys for alerts use prefix `alert:<id>` (ids cannot contain `:`), so `notified`/`lastSeen` never collide; the same prefix applies in API state keys and the dashboard's saved state.

### Shared reader `readCardFolder(dir)` (`src/feed/read-card-folder.ts`)
fs adapter, exported for the CLI (SP04) to reuse: reads card.json, calls `parseCardDef`, reads the data file with `realpath` containment, collects mtimes, returns the inputs for `validateCardFolder` (`{folderId, cardText, data, cardMtimeMs}`). Ingest and CLI `validate`/`list` call it so both resolve folders identically.

### New-content semantics
Entry carries `viewHash` (card.json), `dataHash`, `dataVersion` (= effective `updatedAt`). `CardChange` gains `contentChanged` = (new entry) or (`dataHash` differs). `card.json`-only change emits `changed` with `contentChanged:false` (live re-render, no event, no Done reset). Done reset needs no new code: `acks[id]` compares to effective `updatedAt` (`sameInstant`), so it resets exactly when the data version changes. A no-op rewrite without explicit `updatedAt` gets a new mtime and counts as new (accepted risk, brief).

### Snapshot (pure `computeSnapshot`)
- Per card, in order: hidden → `hidden[]` only (even if Done); else Done (ack matches) → `completed` only, never in `columns`/`now`; else in Now iff `show.cron` set, window active, effective priority ≥ threshold (same rules as today; override priority applies); else placed in `layout.column` list sorted `order` asc, id.
- Every `ViewCard` always has `column` and `height` (defaults resolved server-side), and `collapsed` / `done` as booleans. `doneAt` set only when done. Low-priority (`priority ≤ 1`) cards keep their slot with `collapsed: true`. A card in Now is removed from its column while pinned. Now order unchanged: priority desc, updatedAt desc, id.
- `no-data` cards: slot, `status:'no-data'`, no `updatedAt`/`data`; not eligible for Now (so never Done); can turn Broken-stale.
- Alerts: `alerts[]` sorted priority desc, newest, id; honor `show` window; broken alert files appear as broken rows (tickable). Completed alerts never appear here.
- `completed`: Done cards (all, uncapped) + completed alerts (ticked within `COMPLETED_ALERT_MAX_AGE_MS` = 7 days of `now`, newest `COMPLETED_ALERT_MAX` = 50), merged, sorted by `doneAt`/`tickedAt` desc then id. Alert details in `completedAlertItems`. Older `.done` files stay on disk untouched. The All/Alerts/Cards filter is UI-only (SP03); the server sends everything.
- Skipped folders and loose files are `warnings` (from an ingest `issues()` list; compute stays pure).

### State
New `doneAt: Record<cardId, ISO>`: set by `POST …/done`, cleared by `DELETE …/done` and whenever Done resets (reconcile drops it with the mismatching ack); pruned with the same rule as `acks`. `ViewCard.doneAt` is emitted only while done. `StateSchema` drops `layout`; zod object is non-strict, so an old `state.json` with `layout` loads and the key vanishes at the next write (no warning). Remove `setLayout`, `layout` in `defaults/snapshotOf/restore`. Prune rule and `reconcile` unchanged; present-set adds `alert:<id>` keys and ids of cards with broken data.

### Mutations / actions / paths
Delete `PUT /api/layout`, `LayoutSchema`, `INVALID_LAYOUT`. Kept: `POST /api/cards/:id/done` (also sets `doneAt`), `DELETE …/done` (reopen: card returns to its slot; clears `doneAt`), `PUT/DELETE …/hidden` (cards only), `POST /api/cards/:id/actions`, `POST /api/alerts/:id/tick`. No route embeds a file path (ids only). Tick moves `feed/alerts/<id>.json` to `feed/alerts/.done/` (collision suffix and EXDEV fallback kept; `doneDir` = `feed/alerts/.done`), then sets the moved file's mtime to now with `fs.utimes`: that mtime is the tick time (nobody else writes `.done/`, so no race). No alert un-tick in v1 (futures). `ensureDirs` creates `feed/` and `feed/alerts/` only (no `archive/`). Server startup calls SP04's `syncSchemas(env, assets)` once; failure is logged, non-fatal. `refreshFeed(file)` becomes `refreshFeed({kind:'card'|'alert', id})`.

### Write-back (`complete`)
Reads the resolved data.json (`entry.dataPath`), compare-and-rename as today (hash + mtime/size recheck, tmp `.data.json.<rand>.tmp` in the same folder, `selfWrites[<id>/data.json]`), edits `data.items[i].checked/checkedAt` in the parsed object so all unknown fields survive. **Verified today:** complete never touches `updatedAt`, and selfWrite hash match suppresses events (`src/feed/events.ts` `change.selfWrite`). New hazard: when data.json has no `updatedAt`, the rename bumps mtime and would reset Done/checks/notified. Fix (owner-accepted: adds one key to an agent-owned file): if absent, write-back pins `updatedAt` = prior effective value (instant unchanged). `updatedAt` precondition check in `/actions` uses effective `updatedAt`.

### Notifications
`card:new/changed` fire only when `contentChanged`, non-Broken, in window, effective `updatedAt` ≠ `notified[key]` (unchanged logic). Payload becomes a small view `{kind:'panel'|'alert', id, title, priority, notify, type?, data?, text?, file}` instead of the 01 `Card`. Notifier: alerts use `text` if present else `title` as body (truncated), panels use registry `summary`; "high" = alert and priority ≥ threshold (as today). Alert events: new/changed file content (hash), dedupe `notified['alert:<id>']`. `.done/` files never notify. Open URL fragment for panels `#card=<id>`; alerts open `/`.

### Archive removal (grep-verified `archive|retention` in src)
Delete `src/feed/archive.ts`, `tests/server/archive.test.ts`; remove `onIngest`/`IngestInfo`, `archiveDir`, `ARCHIVE_*` (`constants/feed.ts`), `DEFAULT_RETENTION` (`constants/config.ts`), `retentionDefault` (`config.ts`: field, default, parse branch), `archive.start/stop` and wiring (`server.ts`), `retention` (`contract/envelope.ts`, SP01). Old `config.json` containing `retentionDefault` is ignored silently (parse only reads known keys). Leftover `archive/` and `feed/done/` dirs are untouched (`done` surfaces as a "no card.json" warning; no migration).

## Architecture
```
watcher (fs.watch feed/, recursive; per-folder debounce 200ms; rescan 10s)
  -> ingest.processFolder(id) | processAlert(name) | processCompletedAlert(name)   [sync core, injectable timers]
       readCardFolder(dir) -> SP01 validateCardFolder -> FolderEntry
  -> stores: cards (id), alerts (stem), completedAlerts (stem), issues() (skips, loose files)
  -> onChange(CardChange{contentChanged,selfWrite}) -> events -> notifier
computeSnapshot(cards, alerts, completedAlerts, state, config, now, warnings) -> Snapshot
```
Watcher: one recursive `fs.watch` on `feed/` (Node >= 22.5 supports recursive on Linux, macOS, Windows). Event filename `<id>/<file>`, `alerts/<n>.json` or `alerts/.done/<n>.json` maps to a folder/alert/completed-alert key (dot-prefixed and `.tmp` names dropped, except the `.done` dir); all files of a folder coalesce into one debounce slot, but settling timers are per file. Data files are single-segment names inside the folder, so there is nothing nested to watch. Null filename or watch error: full rescan. The 10 s rescan (readdir feed, each folder, `alerts/` and `alerts/.done/`, stat files) stays the safety net for dropped events, renames, and `mkdir`; a smoke test creates a new subfolder and file and asserts both are picked up (CI runs Linux, macOS, Windows). Chosen over per-folder watchers because Windows locks watched directories (owner could not delete or rename a card folder) and handles need add/remove bookkeeping.

DTO for SP03 (replaces `Zones`, `LayoutItem`, `size`, `kind`):
```ts
type Column = 'left' | 'center' | 'right';
interface ViewCard { id; type; title; priority /*effective*/; notify; updatedAt?: string /*absent if no-data*/;
  column: Column; height: 'S'|'M'|'L'|'auto';   // always set, defaults resolved server-side
  status: 'ok'|'broken'|'no-data'; collapsed: boolean; done: boolean; doneAt?: string /*when done*/;
  reason?; message?; data?; checked?: string[] }
interface ViewAlert { id; title; text?; link?; priority; updatedAt; status:'ok'|'broken'; message? }
interface ViewCompletedAlert { id /* .done file stem, may carry collision suffix */; title; text?; link?; priority; tickedAt: string }
interface Snapshot { serverTime; rev; warnings: string[]; config{pollIntervalMs, nowPriorityThreshold};
  columns: Record<Column, string[]>; now: string[]; alerts: string[]; hidden: string[];
  completed: Array<{ kind: 'card' | 'alert'; id: string }>; // sorted by doneAt/tickedAt desc, then id
  cards: Record<string, ViewCard>;   // Done cards stay here with done:true, doneAt
  alertItems: Record<string, ViewAlert>; completedAlertItems: Record<string, ViewCompletedAlert> }
```
Completed card ids are never in `columns`/`now`/`hidden` (a hidden card is in `hidden` only, even if Done); no-data cards have no `data`.

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| 1 | Watch strategy | One recursive watch on `feed/` + rescan | Per-folder watchers; flat watch + rescan only | Windows dir locks, no handle bookkeeping; rescan already the safety net |
| 2 | Debounce / settle granularity | Debounce per folder, settle per file | Per file debounce | Both files of one card usually land together; one evaluation |
| 3 | Missing card.json warning | Only after 3 s settle | Immediate | `mkdir`-then-write is the normal agent order |
| 4 | Loose root files | Ignore + one warning per name | Silent; Broken card | Helps v0.1.0 leftovers without a tile |
| 5 | Done on panels | Unchanged: ack = effective `updatedAt` | Explicit version counter | Reset-on-new-data falls out for free |
| 6 | Done placement | Done cards leave column and Now, listed in `completed`; back on reopen or new data | Flag in own slot (chip) | Owner 2026-10-08: Completed section |
| 7 | Alerts in snapshot | Separate `alertItems` map + `alerts[]` | Same `cards` map with kind | No id/namespace collision; alerts have no layout/type/data |
| 8 | Alert state keys | `alert:<id>` prefix | Shared ids | Cards and alerts share `notified`/`lastSeen` |
| 9 | Hide on alerts | Dropped (tick only); alerts cannot be hidden, tick moves them to Completed | Keep via prefix | Not requested; fewer states |
| 10 | no-data staleness | card.json mtime as reference | Never stale | Brief: `staleAfter` still applies |
| 11 | `complete` and mtime fallback | Pin `updatedAt` when absent | Restore mtime with `utimes`; ignore | Content-level, cross-platform, survives restart |
| 12 | Old state `layout` | Silently dropped | Warn | Pre-1.0, harmless |
| 13 | Event payload | View object `{kind,id,title,…}` | Keep 01 `Card` | `Card` no longer carries view + data together |
| 14 | Completed contents | Ticked alerts + Done cards | Alerts only | Owner 2026-10-08 |
| 15 | Tick time | `utimes` on the moved `.done` file; ingest reads `.done/` | Persist in state.json | Survives restart, no new state; only the server writes `.done/` |
| 16 | Completed limits | Alerts: 7 days and max 50; Done cards uncapped; older files untouched | Delete old files | No deletion; Done cards are live |
| 17 | Alert un-tick | None in v1 (futures) | Move back | Scope |
| 18 | Card-folder reader | One `readCardFolder(dir)` in SP02, exported to CLI | Duplicate in CLI | Same resolution server and CLI |
| 19 | Data file | Plain file name in folder, realpath-contained | Subpaths | No nested watch |
| 20 | Watcher | One recursive watch + 10 s rescan + new-subfolder smoke test | Per-folder watchers | CI covers Linux/macOS/Windows |
| 21 | `.done/` bad files | Skipped silently (no warning/row) | Warn | Old/foreign files are not actionable |
| 22 | Alert notifier body | `text` if present else `title` | `text` only | `text` optional |

## Risks / Open Questions
- [RESOLVED: owner 2026-10-08 — one recursive watch + 10 s rescan + new-subfolder smoke test; CI already runs Linux/macOS/Windows] Recursive `fs.watch` coverage.
- [RESOLVED: owner 2026-10-08 — SP01 exports `parseCardDef`, result shapes and the path check; `readCardFolder` here reads once] SP01 API fit.
- [RESOLVED: owner 2026-10-08 — pin `updatedAt` when absent; one key added to an agent-owned file is accepted] `complete` write-back.
- [RESOLVED: owner 2026-10-08 — alerts cannot be hidden; ticking moves them to Completed; SP03 must not expose hide] Hide for alerts.
- [RESOLVED: owner 2026-10-08 — data path is a plain file name, no subfolders; symlink escape is broken via realpath, so nothing outside the folder is read or watched] Data path outside the watch.
- [RESOLVED: grep] Config unknown keys are ignored (`config.ts` reads named keys only); zod `StateSchema` is non-strict.
- [DEFERRED] Data-optional types (calendar): `no-data` becomes a registry flag later; snapshot path is one branch.
- [DEFERRED] Alert un-tick (futures.md).
- [DEFERRED] Real notifications of missed `show` windows; unchanged.

## Acceptance Criteria
1. Creating `feed/x/card.json` then `data.json` (either order) yields one card, one `card:new`; card.json-only edit re-renders, emits no event, keeps Done.
2. data.json with new `updatedAt` (or new mtime) resets Done and notifies once; same bytes rewritten with the same explicit `updatedAt` does neither.
3. card.json only: snapshot shows `no-data` in its column; after `staleAfter` shows Broken stale.
4. Columns ordered by `order` then id; Now pinned card absent from its column; low-priority cards keep slot with `collapsed:true`; hidden excluded; every `ViewCard` has `column`, `height`, boolean `collapsed`/`done`; no-data cards have no `updatedAt`/`data`.
5. Folder delete/rename, loose file, folder without card.json (after 3 s) each yield the specified entry/warning and clear when fixed.
6. `complete` on a card with no `updatedAt` keeps Done, checks and notified intact, preserves unknown fields, emits no event.
7. Alert file add/change notifies with `text` if present else `title`; tick moves it to `feed/alerts/.done/`; repeated tick is idempotent 200; alert without `text` loads and renders (`ViewAlert.text` absent).
8. `grep -ri "archive\|retention\|setLayout\|LayoutItem\|/api/layout" src tests` returns nothing; old `state.json` with `layout` and `config.json` with `retentionDefault` load without warnings.
9. Done: card leaves its column and `now`, appears in `completed` with `doneAt`; reopen (`DELETE …/done`) returns it to its slot and clears `doneAt`; new data.json content resets Done, clears `doneAt` and returns it to the column; a hidden Done card is in `hidden` only; a Done card never appears in Now.
10. Tick: file appears in `completedAlertItems` with `tickedAt` ≈ tick time (mtime set via `utimes`), survives server restart, never in `alerts`, never notifies; `.done` file older than 7 days or beyond the newest 50 is excluded but stays on disk; invalid `.done` file is ignored with no warning or row; `completed` sorted by time desc then id.
11. Files starting `.` or ending `.tmp` in card folders and `feed/alerts/` are ignored; data path with `/` or a symlink leaving the folder is skipped with `data-path-invalid`; `ensureDirs` does not create `archive/`; server startup calls `syncSchemas` once and survives its failure.
12. `readCardFolder(dir)` is exported and used by ingest; smoke test: a new subfolder and file created after start is picked up (CI on Linux, macOS, Windows).
13. `npm run validate` passes with `tests/server/{ingest,compute,state,mutations,actions,events,done,paths-config,http,e2e}.test.ts` updated and `archive.test.ts` removed.
