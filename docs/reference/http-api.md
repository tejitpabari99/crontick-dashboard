# HTTP API reference

The server binds `127.0.0.1` only and serves the UI plus a small JSON API used by the UI and the CLI. It is not a public integration surface: agents integrate by writing card folders and alert files, not over HTTP. Error body shape and codes: [errors.md](errors.md).

## Security rules (all routes)

| Rule | Detail |
|------|--------|
| Host allowlist | `Host` must be `127.0.0.1:<port>` or `localhost:<port>` (case-insensitive) else 403 `HOST_FORBIDDEN`. Applies to every route including static files |
| Mutation guard | Every non-GET/HEAD request under `/api/` must send `Content-Type: application/json` and `X-Crontick-Dashboard: 1`, else 403 `MUTATION_HEADER_REQUIRED` (even with no body, and before 404 routing) |
| CORS | No CORS headers are ever sent |

Errors are `{ "error": "<message>", "code": "<CODE>" }`. Internal errors are 500 `INTERNAL` with a fixed message (details only in the server log).

## Routes

Mutation success bodies are `{ "rev": "<snapshot rev>" }` unless noted.

| Method and path | Purpose | Body | Success | Errors |
|-----------------|---------|------|---------|--------|
| `GET /api/health` | Identity probe | none | 200 `{ app: "crontick-dashboard", pid, dataDir }` | |
| `GET /api/snapshot` | Everything the UI renders | none | 200 `Snapshot` with `ETag` and `Cache-Control: no-cache`; 304 when `If-None-Match` matches | |
| `POST /api/shutdown` | Graceful stop | none | 200 `{ ok: true }` | |
| `POST /api/alerts/:id/tick` | Move an alert file to `feed/alerts/.done/` (its file time becomes the tick time) | none | 200; repeating on an already-ticked id is 200 | 404 `CARD_NOT_FOUND` (no such alert); 400 `NOT_AN_ALERT` (the id is a card) |
| `POST /api/cards/:id/done` | Acknowledge the card's current data version; the card moves to Completed | none | 200 | 404 `CARD_NOT_FOUND`; 400 `CARD_BROKEN` |
| `DELETE /api/cards/:id/done` | Remove the acknowledgement (Reopen) | none | 200 | 404 `CARD_NOT_FOUND` |
| `PUT /api/cards/:id/hidden` | Hide the card | none | 200 | 404 `CARD_NOT_FOUND` |
| `DELETE /api/cards/:id/hidden` | Unhide the card | none | 200 | 404 `CARD_NOT_FOUND` |
| `POST /api/cards/:id/actions` | Run a list item action | `{ itemId: string, updatedAt: string, checked?: boolean }` (`checked` defaults to true) | 200 | 404 `CARD_NOT_FOUND`, 400 `CARD_BROKEN`, 400 `INVALID_JSON`, 400 `INVALID_BODY`, 409 `CARD_CHANGED` (client `updatedAt` differs from the data version's, as an instant), 404 `ITEM_NOT_FOUND`, 400 `ITEM_NO_ACTION`, 400 `DISMISS_NOT_UNCHECKABLE` |
| `GET /*` | Static UI | | 200 file, or `index.html` for extension-less paths (SPA) | 404 `NOT_FOUND` for missing assets, `/api/*` unknown routes, and non-GET static paths; 400 `BAD_REQUEST` for malformed URL encoding |

The action type is read from the current card, never from the client. `complete` rewrites `data.json` (compare-and-rename); a concurrent edit yields 409 `CARD_CHANGED`.

## Snapshot shape

`{ serverTime, rev, warnings: string[], config: { pollIntervalMs, nowPriorityThreshold }, columns: { left, center, right }, now, alerts, hidden, completed, cards: Record<id, ViewCard>, alertItems: Record<id, ViewAlert>, completedAlertItems: Record<id, ViewCompletedAlert> }`. Types: `src/shared/api-types.ts`.

- `columns.*`, `now`, `alerts`, `hidden` are arrays of ids (cards, except `alerts` which are alert ids); each column is ordered by `layout.order`, then id. See [zones-and-layout](../concepts/zones-and-layout.md).
- `completed` is the ordered list of Completed rows (a card or an alert, with its id), newest first. Done card ids are in `completed` only (a hidden Done card is in `hidden` only).
- `ViewCard`: `id, type, title, priority` (effective), `notify, column, height, status ("ok" | "broken" | "no-data"), collapsed, done`; `updatedAt` (absent for no-data), `doneAt` (only while done); broken cards add `reason` and `message`; ok cards carry `data` and `checked?` (ticked item ids). No-data cards have no `data`.
- `ViewAlert`: `id, title, text?, link?, priority, updatedAt, status ("ok" | "broken")`, `message` when broken. `ViewCompletedAlert`: `id, title, text?, link?, priority, tickedAt`.
- `reason` is a Broken reason or one of `error`, `stale` (see [errors.md](errors.md#broken-reasons)).
- `warnings` carries config warnings and skipped folders (see [errors.md](errors.md#skipped-folders)).
- `rev` is a content hash (16 hex chars); unchanged content gives an unchanged `rev` and ETag.
