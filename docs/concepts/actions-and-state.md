# Actions and state

Audience: users and contributors who need to know what the UI can change, and where those changes live.
Non-duplication: card placement results are in [zones-and-layout](zones-and-layout.md); the folder and alert file model is in [cards-and-feed](cards-and-feed.md); the exact API routes, request shapes, and `state.json` fields are owned by `docs/reference/`; safety guards are summarized here and enforced per [mission](../tech/mission.md) tenet 6.

## Display first, minimal write-back

The UI is not an input surface. It can search, filter, sort, open links, and make a small, fixed set of changes. Cards never trigger jobs, and the dashboard never becomes the editor of a source system such as TickTick or Outlook.

## What the owner can do

| Interaction | Effect | Stored in |
|---|---|---|
| Tick an alert | Alert leaves the strip and is listed in Completed; its file moves to `feed/alerts/.done/` | the feed (moved file) |
| Done on a card | Acknowledges that card's current data version; the card moves to Completed | `state.json` |
| Reopen a Done card | Card returns to its column slot | `state.json` |
| Hide a card | Removes it from view until restored | `state.json` |
| Tick a list item | Runs the item's declared action | depends on action |

There is no drag or resize: layout is declared in `card.json` (see [zones-and-layout](zones-and-layout.md)), so the UI has no layout to save. Alerts cannot be hidden.

## Done and Completed

A Done acknowledgement is tied to one data version, the effective `updatedAt` of `data.json`. Done cards leave their column (and Now) and are listed in the Completed section with the time they were marked. **Reopen** returns the card to its slot. When the agent writes new data the acknowledgement no longer matches and the card returns to its column on its own, which is why recurring cards (a weekly note, a daily summary) need no manual reset.

Only a new `data.json` version counts as new content. Editing `card.json` (title, layout, priority) re-renders the card but does not reset Done or notify. A rewrite of `data.json` without an explicit `updatedAt` gets a new file time and so counts as new; agents should rewrite only when content really changed.

## Alerts and ticking

Alerts have their own ids (the file name stem), kept apart from card ids in state under an `alert:<id>` key, so a card and an alert can share a name safely. Ticking an alert moves its file from `feed/alerts/` to `feed/alerts/.done/` and sets the moved file's modification time to now; that time is the tick time, shown in Completed and kept across restarts without any extra state.

- Completed lists ticked alerts for 7 days and at most the newest 50. Older files stay on disk untouched; nothing is deleted.
- Ticking twice is harmless.
- There is no un-tick in v1 (see `docs/agent_files/futures.md`).
- Ticked alerts never notify.

## Item actions

A list item may declare an `action` from a fixed set. The server reads the action from the current `data.json`, never from the client request, so a client cannot invent one.

- **`dismiss`.** Recorded as checked in state only. One-way.
- **`complete`.** The server writes the checked flag and a checked time into the item inside `data.json`, atomically, without changing the card's data version: if `data.json` has no `updatedAt`, the write pins one equal to the previous effective value, so the write-back never counts as new content (Done, checks and notification markers stay). The agent reads the file on its next run, completes the real task in the source system with its own access, and rewrites it. The dashboard itself holds no credentials for any source. Unticking is allowed.

If the agent rewrites the file at the same moment, the write-back detects the conflict and asks the client to retry rather than clobbering the agent's version. Server self-writes do not trigger notifications.

(TickTick completion therefore lives in the agent, by design: see [ADR 0001](../decisions/0001-custom-build-and-runtime-model.md); the ingest and Completed rules are in [ADR 0005](../decisions/0005-card-folder-ingest-and-completed.md).)

## State file

`state.json` holds owner decisions that are not card content: hidden ids, Done acknowledgements and times, per-card checked items, notification dedupe markers, and last-seen times for pruning. It holds no layout. It is plain JSON, written atomically by a single serial writer, and created only on the first change. A missing or invalid file falls back to empty state with a warning; a `layout` key left in an old file is ignored and disappears at the next write. State for ids absent from the feed for a long time is pruned.

## Safety

The server binds loopback only. Every request must carry an allowed Host. Mutating requests additionally require a JSON content type and a custom header, which a browser page on another origin cannot send without a preflight the server never grants. There is no CORS and no auth. Links with unsafe schemes are rejected at validation.
