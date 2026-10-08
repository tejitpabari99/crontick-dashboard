# Cards and the feed

Audience: agent authors and contributors who need the mental model of how a card gets from a file to the screen.
Non-duplication: field-by-field shapes belong to `docs/reference/` (card schema); per-type data is in [card-types](card-types.md); where a card lands on screen is in [zones-and-layout](zones-and-layout.md); what ticking and Done do is in [actions-and-state](actions-and-state.md).

## The feed is the interface

Agents feed the dashboard by writing files. There is no SDK, no push API, and no link to crontick or any other scheduler. Anything that can write a file (a crontick job, a Claude session, a shell script) can produce a card. The files are inspectable, survive restarts, and need no running dashboard to be written.

## One card, one folder

A card is a folder `<data>/feed/<id>/` holding two files with two different owners:

- **`card.json` is the view.** It picks the type, title and layout (column, order, height) and carries the display hints (priority, notify, show window, stale limit). It changes rarely; an agent writes it once (the `new` command scaffolds it) and the owner may tweak it by hand.
- **`data.json` is the content.** It holds the type's payload plus `updatedAt` and an optional `error`. The agent rewrites it on every run and never needs to touch `card.json` again.

Splitting them means a recurring job rewrites one small content file, while layout edits never look like new content. Fields: [card schema](../reference/card-schema.md).

- **Identity.** The folder name is the id (a stable lowercase slug). Ids cannot repeat, so there is no duplicate-id case. The id is never read from file bodies.
- **Rewrite in place.** Writing `data.json` again updates the card. A new `updatedAt` (or, without one, a new file time) marks it as fresh content.
- **Write order is free.** Either file may arrive first; the folder is evaluated as a unit once both settle. Write temp-then-rename; names starting with `.` or ending `.tmp` are ignored.
- **Extras are preserved.** Unknown fields are allowed and never stripped, so agents can store their own data. `x-` prefixed keys are reserved for agents.
- **Data path.** `card.json` may name a different data file, but only a plain file name inside the card folder: no subfolders, and symlinks that lead outside are refused.

Alerts are not folders. Each alert is one small file `<data>/feed/alerts/<id>.json` (title required, text and link optional). `alerts` is a reserved name and never a card.

## No data yet

A folder with a valid `card.json` and no `data.json` is shown as a muted card reading "No data yet". That is the normal state between scaffolding and the agent's first write. It is not Broken and raises no warning, though `staleAfter` still applies, counted from the `card.json` time.

## Skipped versus Broken

- **Skipped.** If the folder cannot be treated as a card at all (no `card.json` after a short settle window, an invalid `card.json`, a bad data path, an invalid or reserved id), it is not drawn as a card. A warning in the snapshot says why. Loose files directly in `feed/` get a warning too (cards are folders).
- **Broken.** If `card.json` is fine but the content cannot be shown, the card renders as Broken, with a reason, and never partially. This covers a malformed or invalid `data.json`, a card that sets `error`, and a card older than its `staleAfter`. The reason names what to fix. Half-written files get a short settle-and-retry before being judged.

Reason tables: [errors](../reference/errors.md). The CLI `validate` command reads a folder with the same reader and validator as the server, so what it accepts the server accepts.

## Lifecycle

```
write -> ingest/validate -> visible? -> render
                         -> notify?  -> OS notification
```

- **Visibility.** An optional `show` window (cron plus duration) hides a card outside its time. No `show` means always visible.
- **Deletion.** Deleting the folder removes the card. Hiding it in the UI (without deleting) is recorded in state.
- **Alerts.** Ticking an alert moves its file into `feed/alerts/.done/`. Nothing is deleted, nothing disappears unseen; ticked alerts are listed in Completed.
- **Cards.** "Done" on a card records an acknowledgement of that data version; the card moves to the Completed section until the agent writes new data.

## Resilience

The watcher uses `fs.watch` with debouncing plus a slow rescan as a safety net, so missed events self-heal. Oversized, unreadable, or malformed files surface as Broken or as warnings; they never crash the server. State for cards absent for a long time is pruned.
