# HTTP server implementation

Audience: maintainers changing routes, guards, snapshot computation, or write-back.
Non-duplication: route, header, and status tables are in `docs/reference/http-api.md`; error codes in `docs/reference/errors.md`; safety model in [actions-and-state](../concepts/actions-and-state.md). Here: structure and mechanics.

## Layers

`createApp(ctx)` in `src/http/app.ts` builds a Hono app from an `AppContext` of injected collaborators (clock, config reader, state store, card, alert and completed-alert stores, warnings, dirs, `refreshFeed`, `selfWrites`, `requestShutdown`, `log`). It owns no state. `startServer` (`src/http/server.ts`, see [lifecycle](lifecycle.md)) creates the context. Handlers stay thin: look up the card in the `CardStore`, call a state or action function, return `{ rev }`.

Middleware order matters:

1. `hostGuard(getPort)` on `*`: Host must be `127.0.0.1:<port>` or `localhost:<port>` (lower-cased), else 403 `HOST_FORBIDDEN`. This blocks DNS rebinding. The port is read lazily because it is only known after bind.
2. `GET /api/health` and `GET /api/snapshot` register next.
3. `mutationGuard` on `/api/*`: any non-GET/HEAD request needs `Content-Type: application/json` and `X-Crontick-Dashboard: 1`, else 403 `MUTATION_HEADER_REQUIRED`. A custom header forces a CORS preflight, which the server never answers because no CORS headers exist anywhere.
4. `POST /api/shutdown`, `mountMutations`, `mountActions`.
5. `serveStatic` as the catch-all.

The server listens on `127.0.0.1` only (`LOOPBACK_HOST`); `bind-port.ts` falls back to an OS-assigned port when the preferred one is busy (see [lifecycle](lifecycle.md)).

## Snapshot and ETag

`buildSnapshot` calls the pure `computeSnapshot(cards, alerts, completedAlerts, state, config, now, warnings)` in `src/compute/snapshot.ts` on every request; nothing is cached, so the response always reflects the stores. It:

- builds a `ViewCard` per card folder: `ok` cards, `no-data` cards (no `updatedAt`, never Now or Done), and Broken entries (`type: 'unknown'`, with `reason` and `message`, keeping their layout slot);
- drops cards outside their `show` window; marks `error` and `staleAfter` cards Broken (for no-data cards `staleAfter` runs from the `card.json` mtime);
- assigns each card to exactly one place in this order: hidden, Completed (ack matches the current data version), Now (has `show.cron` and priority at or above the threshold), else its column (`left`, `center`, `right`);
- sorts Now by priority desc, `updatedAt` desc, id; sorts each column by `layout.order`, then id;
- builds the alert list (`alerts`, by priority desc, newest, id) from `feed/alerts/*.json`, honoring each alert's own `show` window, with broken alert files kept as tickable rows;
- builds `completed`: ticked alerts from `.done/` (file mtime within 7 days, newest 50) and Done cards (uncapped), merged newest first;
- builds `rev`, the first 16 hex chars of a sha256 over the body (warnings, config, columns, Now, alerts, hidden, completed, cards and alert items), excluding `serverTime`.

The route sets `ETag: "<rev>"` and `Cache-Control: no-cache`; a matching `If-None-Match` (weak prefix and `*` tolerated) returns 304 with no body. Because `rev` ignores `serverTime`, an idle dashboard polls for nearly free. Time-driven changes (window opens, stale threshold passes) change `rev` on their own because `now` feeds the computation.

Every mutation returns `{ rev }` of the recomputed snapshot; the UI refetches regardless.

## Mutations

`src/http/mutations.ts`: tick alert (`moveToDone` into `feed/alerts/.done/` with the file time set to the tick time, then `refreshFeed`; ticking an already-moved alert is an idempotent 200), Done (`state.markDone` with the current data version and time; refused for Broken cards) and Reopen (`unack`), and hide and unhide. There is no layout route. Ids from URLs are resolved only through the card and alert stores; they never become file paths, so traversal is impossible by construction.

## Item actions

`POST /api/cards/:id/actions` (`src/http/actions.ts`) takes `{ itemId, updatedAt, checked? }`. The server is authoritative: it compares `updatedAt` with the current card (`sameInstant`, else 409 `CARD_CHANGED`), finds the item (`findItemAction`), and takes the action type from the card file, never from the client. `actionRegistry` (`src/actions/registry.ts`) maps `dismiss` and `complete` to handlers.

- `dismiss`: appends the item id to `state.checks[key]` for the current `updatedAt`; one-way (`checked: false` gives 400).
- `complete`: `completeWriteBack` in `src/actions/writeback.ts` edits the card's data file (`data.json`, or the file `card.json` names). Sequence: stat and read the file; compare its hash to the store entry (else `CARD_CHANGED`); parse the raw JSON, verify the effective `updatedAt` (pinned into the file if it had none, so the rewrite is not new content) and that the item has a `complete` action; set `checked` and `checkedAt` (local-offset ISO) or remove `checkedAt`; write a uniquely named dot-tmp file with `wx`; register `selfWrites`; re-stat and re-hash the original just before rename (compare-and-swap); rename with `retryOnBusy`; call `refreshFeed`. If the file changed in the race window it retries once, then reports `CARD_CHANGED`. The raw JSON is re-serialized with 2-space indent, so unknown keys survive but formatting may change. Test seams `rename`, `sleep`, `hooks.beforeCompare` allow injecting the race.

## Errors

`apiError(c, status, code, message)` returns `{ error, code }`. `internalError` logs details through `ctx.log` and returns a fixed 500 body, so exception text never reaches the client. Codes come from `ERROR_CODES`.

## Static UI

`serveStatic(uiDir)` resolves the decoded path under `uiDir`, rejects anything outside it (`startsWith(root + sep)`) and NUL bytes, serves files with a type table, and falls back to `index.html` for extension-less paths (SPA routes). Unknown `/api/*` paths and missing files with an extension return JSON 404. Static files carry no ETag or caching headers. `assertUiBuilt` throws `NOT_BUILT` at startup if `index.html` is missing.
