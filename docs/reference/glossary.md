# Glossary

| Term | Definition |
|------|------------|
| Card | A folder `feed/<id>/` with `card.json` (view) and `data.json` (content); the folder name is the id |
| Card folder | The `feed/<id>/` directory holding one card's files |
| `card.json` | View definition: type, title, layout, priority, notify, show, staleAfter; see [card-schema.md](card-schema.md) |
| `data.json` | Agent-written content: type payload, `updatedAt`, optional `error` |
| Feed | The `feed/` directory under the data dir; agents write cards (folders) and alerts here |
| Data dir | Root of all state (feed, schemas, state, config, process files); see [configuration.md](configuration.md) |
| Alert | A single file `feed/alerts/<id>.json` (title required, text and link optional), shown as a line until ticked |
| Type | Generic visual type: `markdown`, `table`, `list`, `kpi`, `media` |
| Registry | The single list of card types and their schemas, examples and summaries |
| Broken | Render state for an invalid, errored or stale card; names the reason |
| No data yet | A card with a valid `card.json` and no `data.json`; shown muted, not Broken |
| Skipped | A folder that cannot be a card (no or invalid `card.json`, bad data path, bad id); only a snapshot warning |
| Column | `left`, `center` or `right`; where a card sits, declared in `card.json` |
| Slot | A card's place in its column (by `order`), kept even when the card is collapsed |
| Height | `S`, `M`, `L` (fixed) or `auto` (content, capped at the `L` height) |
| Line | An alert's one-row rendering in the alert strip |
| Chip | The collapsed rendering of a low-priority card: one line, click to expand |
| Now zone | Cards with an active `show` window and priority at or above `nowPriorityThreshold`, at the top of the center column |
| Done | Acknowledging a card's current data version; the card moves to Completed until new data |
| Reopen | Returns a Done card from Completed to its slot |
| Tick | Acknowledging an alert; its file moves to `feed/alerts/.done/` and it is listed in Completed |
| Completed | Full-width section below the columns listing Done cards and ticked alerts, newest first (alerts: 7 days, max 50) |
| Filter | Header control All / Alerts / Cards choosing what the page shows |
| Hide | UI-only removal of a card, recorded in state; the files stay |
| Item action | `dismiss` or `complete` on a list item |
| Write-back | Server edit of `data.json` for `complete` (sets `checked`/`checkedAt`; pins `updatedAt` if absent) |
| Show window | `show: { cron, for? }`; when a card is visible, evaluated in config `timezone` |
| Stale | Data older than `staleAfter`; shows Broken |
| State | `state.json`: Done acks and times, hides, item checks, notification markers |
| Schemas dir | `<data>/schemas/`, a copy of the packaged JSON Schemas so `$schema` paths resolve |
| Snapshot | The computed view served by `GET /api/snapshot`; identified by `rev` |
| Daemon | The detached background server started by `daemon start` |
| Gate | Decision whether OS notifications are enabled (`notifications.os` plus platform) |
| Skill | The packaged `SKILL.md` teaching Claude agents to write cards |
