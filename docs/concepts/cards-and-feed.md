# Cards and the feed

Audience: agent authors and contributors who need the mental model of how a card gets from a file to the screen.
Non-duplication: field-by-field shapes belong to `docs/reference/` (card schema); per-type data is in [card-types](card-types.md); where a card lands on screen is in [zones-and-layout](zones-and-layout.md); what ticking and Done do is in [actions-and-state](actions-and-state.md).

## The feed is the interface

Agents feed the dashboard by writing files. There is no SDK, no push API, and no link to crontick or any other scheduler. Anything that can write a file (a crontick job, a Claude session, a shell script) can produce a card. The files are inspectable, survive restarts, and need no running dashboard to be written.

## One card, one file

A card is a single JSON file `<id>.json` in `<data>/feed/`. The file holds both the configuration and the content: an envelope (identity, kind, type, title, priority, timing hints) plus a type-specific `data` body. The agent writes exactly one thing.

- **Identity.** `id` is a stable lowercase slug and must equal the file name without `.json`. A mismatch makes the card Broken rather than guessing.
- **Rewrite in place.** Writing the same file again updates the card. A new `updatedAt` marks it as fresh content.
- **Kinds.** `panel` cards live in the grid. `alert` cards live in a strip at the top and persist until ticked.
- **Extras are preserved.** Unknown fields are allowed and never stripped, so agents can store their own data. `x-` prefixed keys are reserved for agents.

## Validation and Broken

The server validates every file against the card contract (envelope, then the type's data schema). The CLI `validate` command uses the same validator, so what it accepts the server accepts.

A card never shows stale or invalid content. It renders as Broken, with a reason, when the file is malformed or invalid, when the card sets `error`, when it is older than its `staleAfter`, or when its id and file name disagree. The reason names what to fix. Half-written files get a short settle-and-retry before being judged.

## Lifecycle

```
write -> ingest/validate -> (archive previous) -> visible? -> render
                                             -> notify? -> OS notification
```

- **Visibility.** An optional `show` window (cron plus duration) hides a card outside its time. No `show` means always visible.
- **Deletion.** Deleting the file removes the card. Hiding it in the UI (without deleting) is recorded in state.
- **Alerts.** Ticking an alert moves its file to `feed/done/`. Nothing is deleted, nothing disappears unseen.
- **Panels.** "Done" on a panel records an acknowledgement of that `updatedAt`; the card shrinks to a tray chip until the agent writes new content.

## Archive and retention

When a card is overwritten the previous version is archived under `archive/<id>/`, deduplicated, so agents just overwrite and history is kept cheaply. A per-card `retention` (falling back to the config default) bounds how long old versions are kept; pruning runs periodically. The UI shows the latest version only; there is no history viewer in v1.

## Resilience

The watcher uses `fs.watch` with debouncing plus a slow rescan as a safety net, so missed events self-heal. Oversized, unreadable, or duplicate-id files surface as Broken or as warnings; they never crash the server. State for cards absent for a long time is pruned.
