# Feed and ingest implementation

Audience: maintainers changing how card folders and alert files are read, validated, or turned into events.
Non-duplication: user-visible lifecycle, skipped versus Broken, and No data yet semantics are in [cards-and-feed](../concepts/cards-and-feed.md); reason tables are in `docs/reference/errors.md`. Here: the mechanics. Constants live in `src/constants/feed.ts`.

## Pieces

| File | Role |
|------|------|
| `src/feed/read-card-folder.ts` | `readCardFolder(dir)`: the one fs reader for a card folder, shared with the CLI `validate` |
| `src/feed/ingest.ts` | `createFeedIngest`: synchronous core that owns the card, alert and completed-alert stores |
| `src/feed/watcher.ts` | `createFeedWatcher`: recursive `fs.watch` wiring around an ingest |
| `src/feed/events.ts` | `createCardEvents`: change stream to `card:new/changed/removed` |
| `src/feed/done.ts` | `moveToDone`: a tick moves an alert file into `feed/alerts/.done/` |

## Reading a folder

`readCardFolder(dir)` takes the folder name as the id, reads `card.json`, runs `parseCardDef` to learn the data file name, then reads that file after a `realpath` containment check (a symlink leading outside the folder gives a `data-path-invalid` preset result). It returns raw inputs plus an optional `preset` skip; `validateCardFolder` (see [contract](contract.md)) does the judging. Server and CLI therefore resolve folders identically.

## Watcher

One recursive watch on `feed/` (`persistent: false`), a 200 ms debounce keyed per folder, per alert file and per `.done` file (`FEED_DEBOUNCE_MS`), and a full rescan every 10 s (`FEED_RESCAN_MS`). `mapFeedEvent` maps a relative event path to what to re-evaluate and drops dot-prefixed and `.tmp` leaves, so the atomic-write temp files agents and the CLI create are never read. Any event under `<id>/` re-evaluates the whole folder. A null filename triggers a rescan; if `watch` throws, the rescan alone keeps the store correct. `start()` rescans once first, so the startup scan reports every card as `new`.

## Ingest

The ingest is synchronous and timer-injectable, so tests drive it with fake timers. `evaluate(id)` handles a `feed/` child:

- Missing path drops the entry. A loose file is never a card and yields a warning from `issues()`. Dot-prefixed and `alerts` names are ignored.
- The folder is read and validated. **Skipped** results drop the entry and set an issue. A missing `card.json` is given the longest settle delay before the issue is raised, so `new`'s rename and agents that write the data file first do not flicker.
- **Broken** results commit a `broken` entry that keeps the card's layout slot. Possibly half-written files (`malformed-json`, `unreadable`) first enter settling: re-reads at cumulative 250 ms, 1 s, 3 s (`FEED_SETTLE_DELAYS_MS`), restarted by an mtime change; the previous entry stays until the schedule ends. `card.json` and the data file settle under separate keys.
- Valid folders commit `ok` (with `dataVersion`, the effective `updatedAt`) or `no-data`.

`commit` compares a signature (view hash, data hash, version) and only emits `new` or `changed` when it differs; `contentChanged` is true only for a new entry or a different data file hash or version, so `card.json`-only edits never look like new content. Hooks run in try/catch so a listener cannot break ingest.

Alerts: `feed/alerts/<stem>.json` files go through `validateAlertFile` into `alerts` (ok or broken rows, same settling for half-written files); `feed/alerts/.done/` files go into `completedAlerts`, where the tick time is the file mtime and invalid files produce no row. `rescan` drops vanished entries in all three places.

### Self-writes

Write-back registers `selfWrites["<id>/data.json"] = sha256(bytes)` before renaming. When the watcher re-reads and the hash matches, the change is flagged `selfWrite` and events do not fire. The server also calls `processFolder` directly after its own writes (`refreshFeed`), so the UI never waits for the debounce.

## Events

`createCardEvents().onChange` emits only for `ok`, in-window, non-Broken cards whose `contentChanged` is true and whose version is not already in `state.notified[key]` (compared with `sameInstant`), then stamps `notified` through the state store. `onAlertChange` does the same for valid alert files under `notified["alert:<id>"]`. Suppressed cards are not stamped, so they fire when they become eligible. `card:removed` fires when an ok card disappears. `flush()` awaits stamps at shutdown.

## Done and tick

`moveToDone` renames `feed/alerts/<file>` into `feed/alerts/.done/`, appending `-<ms>` on collision, falling back to copy plus unlink on `EXDEV`, then sets atime and mtime to the tick time (`touchAt`). A missing source counts as success. `.done/` files are never pruned or deleted; Completed just stops listing old ones. Done on a *card* is not a file move: it is an ack in `state.json`, see [state](state.md).
