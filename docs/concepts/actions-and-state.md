# Actions and state

Audience: users and contributors who need to know what the UI can change, and where those changes live.
Non-duplication: card placement results are in [zones-and-layout](zones-and-layout.md); the file and archive model is in [cards-and-feed](cards-and-feed.md); the exact API routes, request shapes, and `state.json` fields are owned by `docs/reference/`; safety guards are summarized here and enforced per [mission](../tech/mission.md) tenet 6.

## Display first, minimal write-back

The UI is not an input surface. It can search, filter, sort, open links, and make a small, fixed set of changes. Cards never trigger jobs, and the dashboard never becomes the editor of a source system such as TickTick or Outlook.

## What the owner can do

| Interaction | Effect | Stored in |
|---|---|---|
| Tick an alert | Alert leaves the strip; its file moves to `feed/done/` | the feed (moved file) |
| Done on a panel | Acknowledges that card's current `updatedAt`; shown as a tray chip | `state.json` |
| Hide a card | Removes it from view until restored | `state.json` |
| Drag / resize | Persists layout | `state.json` |
| Tick a list item | Runs the item's declared action | depends on action |

A Done acknowledgement is tied to one `updatedAt`. When the agent writes fresh content the acknowledgement no longer matches and the card returns to normal on its own, which is why recurring cards (a weekly note, a daily summary) need no manual reset.

## Item actions

A list item may declare an `action` from a fixed set. The server reads the action from the current card file, never from the client request, so a client cannot invent one.

- **`dismiss`.** Recorded as checked in state only. One-way.
- **`complete`.** The server writes the checked flag and a checked time into the item inside the card file, atomically, without touching `updatedAt`. The agent reads the card on its next run, completes the real task in the source system with its own access, and rewrites the card. The dashboard itself holds no credentials for any source. Unticking is allowed.

If the agent rewrites the card at the same moment, the write-back detects the conflict and asks the client to retry rather than clobbering the agent's version. Server self-writes do not trigger notifications or archive entries.

(TickTick completion therefore lives in the agent, by design: see [ADR 0001](../decisions/0001-custom-build-and-runtime-model.md).)

## State file

`state.json` holds owner decisions that are not card content: layout, hidden ids, Done acknowledgements, per-card checked items, notification dedupe markers, and last-seen times for pruning. It is plain JSON, written atomically by a single serial writer, and created only on the first change. A missing or invalid file falls back to empty state with a warning. State for ids absent from the feed for a long time is pruned.

## Safety

The server binds loopback only. Every request must carry an allowed Host. Mutating requests additionally require a JSON content type and a custom header, which a browser page on another origin cannot send without a preflight the server never grants. There is no CORS and no auth. Links with unsafe schemes are rejected at validation.
