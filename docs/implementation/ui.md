# UI implementation

Audience: maintainers changing the React app in `ui/`.
Non-duplication: the page, columns, chips, Completed section, filter and polling behavior as users see them are in [zones-and-layout](../concepts/zones-and-layout.md); the visual-type model in [card-types](../concepts/card-types.md); API shapes in `docs/reference/http-api.md`. Here: how the client is structured.

The UI is a Vite React app (`ui/`, root `ui/`, `base: './'`) with its own `tsconfig.json`. It imports only types and a few constants from `src/` (`src/index.js`, `src/constants/*`), never server code.

## Data flow

```
 server /api/snapshot --(ETag poll)--> SnapshotStore --> mutations view (optimistic) --> zones --> CardFrame --> registered Body
```

### Snapshot store (`ui/src/api/store.ts`)

`createSnapshotStore` is an external store for `useSyncExternalStore`. Polling starts with the first subscriber and stops with the last. Details:

- `client.getSnapshot(etag)` sends `If-None-Match`; 304 keeps the current snapshot and only refreshes `lastSuccessAt`.
- Interval is the snapshot's `config.pollIntervalMs`, clamped to 15-60 s with the server's constants (`src/constants/poll.ts`); hidden tabs poll every 60 s; a `visibilitychange` to visible refetches at once.
- `shareStructure` reuses unchanged subtrees of the previous snapshot, so React re-renders only cards that changed.
- Failure handling: the first failure keeps the last snapshot; after 2 consecutive failures (or none loaded, or no success for over 2 poll intervals) the store sets `serverDown`, **drops the snapshot and ETag** so nothing stale stays visible, and retries at 5, 10, 30 s (`ui/src/constants/polling.ts`). `ServerDown.tsx` renders the page.
- `refetch({ fresh: true })` waits for any in-flight request first (it may predate a mutation).

Timers, clock, client, and visibility document are injectable (`StoreOptions`), so `ui/tests/store.test.ts` runs without real time.

### Mutations (`ui/src/api/mutations.ts`)

`createMutations` layers optimistic patches over the store. Each action (`done`, `reopen`, `hide`, `unhide`, `tick`, `onItemAction`) pushes an op, sends the request with the mutation headers, and on success awaits `refetch({ fresh: true })` and **only then** removes the op, so the patch stays until the real snapshot carries the truth. On failure the op is removed, an error toast shows the server message (`CARD_CHANGED` shows a fixed "card updated" toast), and a refetch runs; `onItemAction` rethrows so the item can reset. `getView()` applies zone ops (Done, hide, tick) to the snapshot and exposes per-card `pending` item ids. If the server goes down all ops are discarded.

Item checks shown = snapshot `checked` ids, plus item `checked` in data, plus optimistic ops (`getChecked`).

## Registry of renderers

`ui/src/registry/registry.ts`: `registerCardType(type, { Component, searchText, allowedModes? })` fills a map keyed by the contract's type names; `getCardType(raw)` returns undefined for unknown types and `CardFrame` then renders `UnknownBody`. Each visual type is a folder `ui/src/types/<type>/` with `index.ts` (registration), `<Type>Body.tsx`, `logic.ts` (pure, unit-testable), and CSS; `ui/src/types/index.ts` imports each `index.ts`. Shared helpers (clamp, format, highlight, `safeImageSrc`, `useQueryFilter`, `ShowMore`) live in `types/shared/`. Bodies receive `{ card, data, mode, query, checked, pending, onItemAction }`, where `mode` is `column | now | fullscreen`.

`CardFrame` provides uniform chrome (title, priority, actions, Broken state, error boundary), so a throwing body cannot take down the page. Links allow only the contract's schemes (`LINK_SCHEMES`). Adding a type is the UI half of the checklist in [contract](contract.md).

## Page structure

`ui/src/zones/`: `Header`, `AlertStrip`, `Columns` (with `NowZone`), `Completed`, `HiddenPopover`, `SearchBox`, `ServerDown`, `ToastHost`. The server decides membership and order; the UI only renders.

`App` owns the cross-cutting UI state: the header filter (`lib/filter.ts`: `all | alerts | cards`), the Completed open flag (`lib/completed-open.ts`), the search query, and the hash target. Filter and open flag persist in `localStorage` (`ui/src/constants/storage.ts`), always in try/catch.

- **Layout.** `Columns` is a plain CSS grid (`columns.css`): `left | center | right` areas, fixed side width from a token, flexible center, collapsing to `center, left, right` at the 1200 px breakpoint. DOM order is center, left, right so tab order matches the stacked layout. There is no layout library and no layout state.
- **Cards.** `Columns` renders `NowZone` first in the center column, then each column's cards. A card with `collapsed` set renders as a `Chip` until expanded (`setExpanded` in `CardFrame`); heights come from a `card-frame--h-<S|M|L|auto>` class. A `no-data` card shows "No data yet" in the body.
- **AlertStrip.** One single-line row per alert (dot, title, optional text and link, Tick). Hidden when the filter is Cards.
- **Completed.** `resolveCompleted(snapshot, filter)` turns `snapshot.completed` into rows (Done cards need the card in `snapshot.cards`; ticked alerts come from `completedAlertItems`). The Alerts filter drops card rows and the Cards filter drops alert rows. Collapsible, default open, hidden when empty.
- **Header.** Date, alert badge, the filter radio group, search, hidden-cards popover, theme toggle. `lib/seen.ts` keeps "new" markers in `localStorage`; `lib/attention.ts` derives the tab-title count.

## Search and deep links

`lib/search.ts` matches all tokens, case-insensitively, against title plus the type's registered `searchText` (Broken: title plus message; alerts: title plus text). `App` builds hits from what the current filter shows: with filter Alerts, only alert and completed-alert rows are searched and the hidden-cards list is not offered; with Cards, alerts are not searched. Completed rows match only when the section is open or are listed as "other matches" that open it.

`lib/hash.ts` parses `#card=<id>[&view=full]`. After the first snapshot `App` clears the hash and acts on the target: an unknown id toasts "card not found"; `view=full` opens fullscreen; a **Done** card opens the Completed section, scrolls to and highlights its row, and switches the filter to All **only when it is Alerts** (under Cards the Completed card rows are already visible); a hidden card toasts that it is hidden; otherwise the card is scrolled into view and highlighted. Notification toasts use this link.

## Theme

`ui/src/theme/`: `tokens.css` derives every surface, border, and text color from a few HSL inputs in `themes.css` (dark and light presets, `--dir` flips surface direction). `lib/theme.ts` stores the choice (`system | light | dark`) under `crontick-dashboard.theme` and sets `data-theme` on `<html>`; `system` follows `prefers-color-scheme` live. An inline script in `ui/index.html` applies the stored choice before first paint; `THEME_KEY` must match it, which `ui/tests/theme.test.ts` asserts along with palette contrast.
