# Feed and ingest implementation

Audience: maintainers changing how card files are read, deduplicated, archived, or turned into events.
Non-duplication: user-visible lifecycle, retention, and Broken semantics are in [cards-and-feed](../concepts/cards-and-feed.md). Here: the mechanics. Constants live in `src/constants/feed.ts`.

## Pieces

| File | Role |
|------|------|
| `src/feed/ingest.ts` | `createFeedIngest`: synchronous core that owns the `CardStore` |
| `src/feed/watcher.ts` | `createFeedWatcher`: `fs.watch` wiring around an ingest |
| `src/feed/events.ts` | `createCardEvents`: change stream to `card:new/changed/removed` |
| `src/feed/archive.ts` | `createArchive`: versioned history and pruning |
| `src/feed/done.ts` | `moveToDone`: tick moves a file to `feed/done/` |

## Watcher

`createFeedWatcher` wraps an ingest and adds three things: a flat `fs.watch` on the feed dir (`persistent: false`, so it never keeps the process alive), a 200 ms per-file debounce (`FEED_DEBOUNCE_MS`; a new event for the same name replaces the pending timer), and a rescan every 10 s (`FEED_RESCAN_MS`). Events for names that are not feed files are dropped (`isFeedFile`: `.json`, not dotfile, not `.tmp`). A null filename (some platforms) triggers a full rescan. If `watch` throws or errors, the rescan alone keeps the store correct; it is the safety net, not an optimization. `start()` rescans once before watching so the startup scan reports every card as `new`.

## Ingest

The ingest is synchronous and timer-injectable, so tests drive it with fake timers.

`processFile(name)` reads with up to 3 attempts on `EBUSY`/`EPERM`, classifies the result (`gone`, `dir`, `toolarge`, `error`, `read`), and `evaluate` commits a record unless the content is `malformed-json` or `unreadable`. Those two reasons are treated as a possible half-written file and enter settling: re-reads at cumulative 250 ms, 1 s, and 3 s (`FEED_SETTLE_DELAYS_MS`). A changed mtime restarts the schedule; after the last attempt the file is finalized as Broken. Every other broken reason is committed immediately.

`rebuild` recomputes the whole store from per-file records after every change, then diffs against the previous store to emit `new`, `changed` (hash, file, status, or message differs), or `removed`:

- Store key is the card id for valid cards.
- Two files with the same id: newest `updatedAt` wins, ties by mtime then name; losers become Broken `duplicate-id` entries keyed `file:<name>`.
- Broken files claim their `id` key unless `id-mismatch` or a valid card holds it; otherwise key `file:<name>`. Files whose stem equals their id sort first.

`rescan` removes records for vanished files and re-processes files whose mtime or size changed.

Hooks run inside try/catch so a listener can never break ingest. `onIngest` fires only for newly accepted valid content (same hash and mtime is skipped) before the store is rebuilt; it feeds the archive.

### Self-writes

Write-back registers `selfWrites[file] = sha256(bytes)` before renaming. When the watcher re-reads and the hash matches, `IngestInfo.selfWrite` and `CardChange.selfWrite` are true: the archive ignores it and events do not fire. The server also calls `processFile` directly after its own writes (`refreshFeed`), so the UI never waits for the debounce.

## Events

`createCardEvents().onChange` emits only for non-Broken, in-window cards (`brokenReason`, `inWindow` from `src/compute/snapshot.ts`) whose `updatedAt` is not already in `state.notified[key]` (compared with `sameInstant`), then stamps `notified` through the state store. Suppressed cards are not stamped, so they fire when they become eligible. `card:removed` fires when an ok card disappears. Stamp promises are tracked; `flush()` awaits them at shutdown. Persist failures set the `notified` warning.

## Archive

Layout `archive/<id>/<safe-updatedAt>-<hash8>.json`, where hash8 is the first 8 hex chars of a sha256 of canonical (key-sorted) JSON. On each non-self ingest: list versions, compare the newest version's hash8 with the new one, and write only if different (tmp file plus rename, mode 0600, mtime set from the injected clock). The newest version is derived from disk, so restarts never duplicate.

Pruning runs per id on ingest and for all ids hourly (`ARCHIVE_PRUNE_INTERVAL_MS`). Retention is the card's `retention`, else config `retentionDefault`, else 7 days. For a current card the newest version is always kept; for ids no longer in the feed everything ages out and the empty dir is removed. Age is the file mtime (archive time), not `updatedAt`.

## Done

`moveToDone` renames `feed/<file>` to `feed/done/<file>`, appending `-<ms>` on collision and falling back to copy plus unlink on `EXDEV`. A missing source counts as success. `feed/done/` is never pruned.
