# Glossary

| Term | Definition |
|------|------------|
| Card | One JSON file in the feed: envelope plus type-specific `data` |
| Feed | The `feed/` directory under the data dir; agents write cards here |
| Data dir | Root of all state (feed, archive, state, config, process files); see [configuration.md](configuration.md) |
| Envelope | Common card fields: id, kind, type, title, updatedAt, priority, notify, show, staleAfter, retention, size, error |
| Kind | `panel` (grid) or `alert` (top strip until ticked) |
| Type | Generic visual type: `markdown`, `table`, `list`, `kpi`, `media` |
| Registry | The single list of card types and their schemas, examples, summaries and allowed kinds |
| Broken | Render state for an invalid, errored, stale or mismatched card; names the reason |
| Zone | Region of the UI: alert strip, Now, grid, Done tray, hidden |
| Now zone | Panels with an active `show` window and priority at or above `nowPriorityThreshold` |
| Done | Acknowledging a panel's current `updatedAt`; it shrinks to a tray chip until new content |
| Tick | Acknowledging an alert; its file moves to `feed/done/` |
| Hide | UI-only removal of a card, recorded in state; the file stays |
| Item action | `dismiss` or `complete` on a list item |
| Write-back | Server edit of a card file for `complete` (sets `checked`/`checkedAt`) |
| Show window | `show: { cron, for? }`; when a card is visible, evaluated in config `timezone` |
| Stale | Older than `staleAfter`; shows Broken |
| Retention | How long archived versions of a card are kept |
| Archive | `archive/<id>/` holding previous versions of overwritten cards |
| State | `state.json`: acks, hides, item checks, layout, notification markers |
| Snapshot | The computed view served by `GET /api/snapshot`; identified by `rev` |
| Daemon | The detached background server started by `daemon start` |
| Gate | Decision whether OS notifications are enabled (`notifications.os` plus platform) |
| Skill | The packaged `SKILL.md` teaching Claude agents to write cards |
