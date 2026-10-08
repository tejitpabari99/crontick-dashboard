# State implementation

Audience: maintainers changing `state.json`, config loading, or warnings.
Non-duplication: what state means to the owner is in [actions-and-state](../concepts/actions-and-state.md); the config keys are in `docs/reference/configuration.md`. This page covers the store mechanics.

## state.json store

`src/state/store.ts` (`createStateStore`) holds `{ version: 1, acks, hidden, doneAt, checks, notified, lastSeen }`. There is no layout: positions are declared in `card.json`. Unknown keys from older files (such as `layout`) are ignored on load. Path comes from `statePath(env)` in `src/paths.ts`.

- **Lazy creation.** No file exists until the first mutation. `reconcile` returns early when the file is absent.
- **Null-prototype maps.** Card ids are not constrained enough to rule out `__proto__`, so per-id maps are built with `Object.create(null)` and read with `Object.hasOwn`. `load` rebuilds them from the raw JSON because zod's `record` drops `__proto__` keys.
- **Serial writer.** Every mutation goes through `mutate(fn)`, which chains onto one promise queue. It snapshots the state, applies `fn` in memory, then `write()`s. If `fn` returns `false` the write is skipped (nothing changed). If anything throws, the in-memory state is restored from the snapshot so memory never diverges from disk; the queue itself survives the error.
- **Atomic write.** Write `state.json.tmp` (mode 0600), then `rename` over the target, retried on `EPERM` with exponential backoff (`retryOnBusy`, `RENAME_TRIES` = 5, base `STATE_RENAME_BACKOFF_MS` = 20 ms) for Windows file-lock races. `renameFn` and `retryDelayMs` are injectable.
- **Corrupt file.** A parse or schema failure moves the file to `state.json.corrupt-<timestamp>`, starts with defaults, and records a message in `store.warnings`, which the snapshot surfaces.

Typed helpers (`markDone`, `unack`, `hide`, `setChecks`, `setNotified`) are one-line `mutate` calls. `markDone` stores the ack (the data version's effective `updatedAt`) and `doneAt` (when the owner clicked Done, shown in Completed); `unack` (Reopen) removes both. `checks[id]` stores the card `updatedAt` it applies to; the snapshot ignores checks whose `updatedAt` no longer matches (`sameInstant`), which is how a rewritten card resets item ticks.

### Reconcile and pruning

`reconcile(presentIds, currentUpdatedAt)` runs at startup and hourly (`RECONCILE_INTERVAL_MS`, driven by `startServer`). An ack that no longer matches a card's current data version is dropped with its `doneAt`. Ids currently in the feed get `lastSeen = now`, but only when the previous value is older than an hour (`LAST_SEEN_GRANULARITY_MS`), so idle reconciles do not rewrite the file. Ids that have state but are absent get a `lastSeen` if missing, and are deleted from every map once absent for more than 30 days (`STATE_PRUNE_AFTER_MS`). A temporarily Broken card with a known id counts as present, so it keeps its state.

## Config

`src/config.ts`: `parseConfig(raw)` starts from `defaultConfig()` and validates each field independently; an invalid field is replaced by its default and adds a warning (`config.json: invalid <name>; using ...`). A non-object or unparsable file yields all defaults with one warning. A missing file yields defaults with no warning. Defaults and bounds come from `src/constants/config.ts`, `http.ts`, and `poll.ts`.

`createConfigReader().get()` caches the parsed result and re-reads when the file's mtime changes (or it appears or disappears), so edits apply without a restart except `port`. Port precedence in `resolvePort`: env `CRONTICK_DASHBOARD_PORT`, then config, then 47616; an invalid env value is ignored. The CLI `--port` flag and `startServer({ port })` override all.

`ensureDirs` (`src/paths.ts`) creates the data, `feed/`, and `feed/alerts/` dirs with mode 0700 and writes `{}` to `config.json` only if missing (`wx`).

## Warnings

`createWarnings()` is a keyed registry (`set`, `clear`, `list`); setting an existing key replaces its message. Producers use fixed keys (`notified`, `notifications`, `notifications-delivery`). `buildSnapshot` concatenates `state.warnings`, the registry, and config warnings into `snapshot.warnings`; being part of the snapshot body, they also change `rev`.
