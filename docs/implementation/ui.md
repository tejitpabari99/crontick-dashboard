# UI implementation

Audience: maintainers changing the React app in `ui/`.
Non-duplication: zones, anti-crowding, and polling behavior as users see them are in [zones-and-layout](../concepts/zones-and-layout.md); the visual-type model in [card-types](../concepts/card-types.md); API shapes in `docs/reference/http-api.md`. Here: how the client is structured.

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
- Failure handling: the first failure keeps the last snapshot; after 2 consecutive failures, or a failure with nothing loaded, or no success for more than 2 poll intervals, the store sets `serverDown`, **drops the snapshot and ETag** (nothing stale may stay visible), and retries at 5 s, 10 s, 30 s (`ui/src/constants/polling.ts`). `ServerDown.tsx` renders the page; the header shrinks to the theme toggle and a red dot.
- `refetch({ fresh: true })` waits for any in-flight request first, since its response may predate a mutation.

Timers, clock, client, and the visibility document are injectable (`StoreOptions`), which is how `ui/tests/store.test.ts` runs without real time.

### Mutations (`ui/src/api/mutations.ts`)

`createMutations` layers optimistic patches over the store. Each action (`done`, `undone`, `hide`, `unhide`, `tick`, `putLayout`, `onItemAction`) pushes an op, issues the request with the mutation headers, and on success awaits `refetch({ fresh: true })` and **only then** removes the op, so the patch stays until the real snapshot carries the truth (no flicker). On failure the op is removed, an error toast shows the server message (a `CARD_CHANGED` code shows a fixed "card was updated" toast), a refetch runs, and public wrappers swallow the rejection while `onItemAction` rethrows so the item can reset. `getView()` applies zone and layout ops to the snapshot and exposes per-card `pending` item ids, memoized on `(state, ops)` identity. If the server goes down, all ops are discarded. `putLayoutKeepalive` is a fire-and-forget `keepalive` PUT for `pagehide`.

Item checks shown = snapshot `checked` ids, plus item `checked` in data, plus optimistic ops (`getChecked`).

## Registry of renderers

`ui/src/registry/registry.ts`: `registerCardType(type, { Component, searchText, allowedModes? })` fills a map keyed by the contract's type names; `getCardType(raw)` returns undefined for unknown types and `CardFrame` then renders `UnknownBody`. Each visual type is a folder `ui/src/types/<type>/` with `index.ts` (registration), `<Type>Body.tsx`, `logic.ts` (pure, unit-testable), and CSS; `ui/src/types/index.ts` imports each `index.ts`. Shared helpers (clamp, format, highlight, `safeImageSrc`, `useQueryFilter`, `ShowMore`) live in `types/shared/`. Bodies receive `{ card, data, mode, query, checked, pending, onItemAction }`, where `mode` is `grid | now | alert | fullscreen`.

`CardFrame` provides uniform chrome (title, priority, actions, Broken state, error boundary), so a throwing body cannot take down the page. Link rendering allows only the contract's schemes (`LINK_SCHEMES`). Adding a type is the UI half of the checklist in [contract](contract.md).

## Zones and grid

`ui/src/zones/`: `AlertStrip`, `NowZone`, `Grid`, `DoneTray`, `HiddenPopover`, `Header` (search), `ToastHost`. The server decides membership (`snapshot.zones`); the UI only renders and orders.

The grid uses `react-grid-layout` with 12 columns, 28 px rows (`ui/src/constants/grid.ts`). `lib/placement.ts` (`placeCards`) is a pure first-free-slot packer: cards without a layout entry get a slot by size (S 3x4, M 3x7, L 6x9) in snapshot order, and entries for cards currently absent from the grid still block slots, so a card returning from Done or hidden gets its old position. `layout-writer.ts` debounces drags into one `PUT /api/layout` per burst and flushes with keepalive on `pagehide`. `Grid` keeps a local override while dragging or while a write is pending, so snapshots arriving mid-drag do not fight the user. Collapsed low-priority panels render as chips until expanded. `lib/seen.ts` keeps "new" markers in `localStorage`.

## Theme

`ui/src/theme/`: `tokens.css` derives every surface, border, and text color from a few HSL inputs in `themes.css` (dark and light presets, `--dir` flips surface direction). `lib/theme.ts` stores the choice (`system | light | dark`) under `crontick-dashboard.theme` and sets `data-theme` on `<html>`; `system` follows `prefers-color-scheme` live. An inline script in `ui/index.html` applies the stored choice before first paint to avoid a flash; `THEME_KEY` must match it, which `ui/tests/theme.test.ts` asserts, along with contrast ratios of the derived palettes. All `localStorage` access is in try/catch.

## Deep links

`lib/hash.ts` parses `#card=<id>[&view=full]`; `App` waits for the first snapshot, then scrolls to and highlights the card (or opens fullscreen). Notification toasts use this link.
