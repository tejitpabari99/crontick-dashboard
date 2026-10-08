# 0005: Card-folder ingest, Completed list and write-back rules

- Status: Accepted
- Date: 2026-10-08

## Context

Panels moved from one flat JSON file per card to a folder per card (view in `card.json`, content in `data.json`), alerts stay single files, and the grid/tray layout became three declared columns. The server needed lasting rules for ingest, watching, Done semantics and write-back that follow from this.

## Decision

- **Card folders.** `feed/<id>/card.json` (view) + `feed/<id>/data.json` (content). Store key is the folder name, so duplicate ids are impossible (`duplicate-id` no longer exists). A missing `data.json` is a shown, muted `no-data` card; one shared `readCardFolder(dir)` reads a folder identically for ingest and the CLI, and the data path must be a plain file name that stays inside the folder after `realpath`.
- **One recursive watch plus rescan.** A single recursive `fs.watch` on `feed/` (debounce per folder, settling per file) with a 10 s full rescan as the safety net. Per-folder watchers were rejected: Windows locks watched directories and handles need add/remove bookkeeping.
- **Done cards move to Completed.** A Done card (ack equals effective `updatedAt`) leaves its column and Now and is listed in `completed` with `doneAt`, merged with ticked alerts. Only new `data.json` content resets Done; a `card.json`-only edit re-renders without events or resets.
- **Alert tick time.** Ticking moves `feed/alerts/<id>.json` to `feed/alerts/.done/` and sets the moved file's mtime to now with `utimes`. That mtime is `tickedAt`, so it survives restarts with no extra state. Completed alerts are limited to 7 days and the newest 50; older files stay on disk.
- **`complete` write-back pins `updatedAt`.** When `data.json` has no `updatedAt`, the rename would bump mtime and reset Done, checks and notified. The write-back therefore writes `updatedAt` equal to the prior effective instant. One key is added to an agent-owned file; all other fields are preserved.
- **Removed.** Archive, `retention`/`retentionDefault`, saved `layout` state and `/api/layout`. Old `state.json`/`config.json` with those keys load silently.

## Alternatives considered

Per-folder watchers; a Done chip kept in the card's slot; persisting tick time in `state.json`; restoring mtime with `utimes` after write-back; an explicit data version counter instead of `updatedAt`.

## Consequences

Content and presentation change independently, and one reader serves server and CLI. Agents may write the two files in any order. Alerts cannot be hidden or un-ticked in v1. A no-op rewrite of `data.json` without explicit `updatedAt` counts as new content. Leftover `archive/`, `feed/done/` and v0.1.0 flat files are not migrated (they surface as warnings).

## Revisit when

Recursive `fs.watch` proves unreliable on a supported platform, alert un-tick is wanted, or data-optional card types need a registry flag for `no-data`.
