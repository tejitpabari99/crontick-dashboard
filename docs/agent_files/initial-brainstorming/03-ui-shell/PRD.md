---
status: approved
summary: React/Vite UI shell — HSL theme tokens, header/Now/grid/Done-tray zones, uniform card frame, client type registry, global search, ETag polling, optimistic mutations.
date: 2026-10-05
---
# PRD: UI shell (03)
Repo/branch: crontick-dashboard / `initial-brainstorming` · Depends on: 01 (types only), 02 (HTTP API) · Owns: `ui/**` (Vite root: `index.html`, `src/`, `tests/`, `vite.config.ts`), `tests/smoke/**`, `ui` tsconfig + vitest project

## TL;DR
A single-page React app that renders 02's snapshot: slim header, Now zone, fixed-position react-grid-layout grid, Done tray. Every card sits in one uniform frame (title, fullscreen, Done, hide, Broken, collapsed chip); 04's five type components plug in through a typed client registry. Calm, dense, flat, Glance-derived HSL tokens, one accent, light + dark. Built by Vite to `ui/dist/`; 06's build copies it to `dist/ui/`, served by 02.

## Problem
Agent-written cards are only valuable if they surface on time, on top, without crowding (kill criteria, §2). The shell must make crowding structurally hard (compact defaults, collapse, no auto-reorder), make failure visible (D19), and give 04 a stable frame so types stay tiny components.

## Goals / Non-Goals
Goals: scope items 1–8 of SP03; spatial memory preserved; every state recoverable (hidden, Done); never show stale data (D19: server down = "Server down" state only); keyboard/AA basics; works offline from CDNs (no external fonts/scripts).
Non-Goals (futures.md / D31): mobile layout, multi-page, embed, extra theme presets, SSE, weather, UI → agent inputs, history viewer, OS notifications (05), type internals (04), server logic (02).

## Requirements

### Zones (top to bottom)
1. **Header** (sticky, ~44px): date; alert count badge (unticked alerts; click scrolls to Now); global search; `Hidden (n)` popover; theme toggle; connection dot. `document.title` = `(n) Crontick` where n = alerts + unseen notify cards.
2. **Now zone** (rendered only if non-empty): *alert strip* (compact, side-by-side, wrapping, snapshot order = priority desc then newest) then *promoted panels* (full cards in a wrapping flex row, min 320px, snapshot `zones.now` order). Alert: compact row (title, priority marker, type body at `mode:'alert'`), only action is **Tick** (`POST /api/alerts/:id/tick`); alerts cannot be hidden or collapsed (unmissable, D11/D13).
3. **Grid**: react-grid-layout, 12 columns, one breakpoint (desktop only), `rowHeight` 28px, margin 10px. Cards in `zones.grid` only.
4. **Done tray** (bottom, only if non-empty): heading-only chips (title + small age); click = reopen (`DELETE /api/cards/:id/done`).

### Grid behavior
- **Default narrow–wide–narrow**: bands 3 | 6 | 3 columns. Size hints → default `w×h`: S `3×4`, M `3×7`, L `6×9` (S/M fit a narrow band, L the wide band). Missing size = M (01 default).
- **Auto-placement (D21)**: a grid card with no entry in `layout` gets the first free slot scanning rows top→bottom, x left→right, in snapshot order; the placed layout is persisted. Placement is a pure function (tested). Never moves existing cards.
- **No auto-reorder**: priority never affects grid position. Vertical compaction is on for *rendering* (so promoted/Done/hidden cards leave no hole) but layout is persisted **only on drag/resize stop**, never from `onLayoutChange`. Entries for cards currently absent from the grid (Now, Done, hidden, outside window) are retained untouched, so a card returns to its slot (D12).
- **Persist**: `PUT /api/layout` with full array, debounced 800 ms after drag/resize/placement; flushed on `pagehide` (`fetch keepalive`). Last write wins; snapshot layout is ignored while a drag is active.
- **Collapsed chip (D22)**: `collapsed` cards render at `h=1` (title, priority dot, expand chevron); expand is UI-local (per-session map) and restores stored `h`; collapsed height is a render override, never persisted.
- **Fullscreen**: native `<dialog>` modal (focus trap, Esc closes, restores focus), card rendered at `mode:'fullscreen'`; open state in URL hash `#card=<id>&view=full`.
- **Deep link (05 toast click)**: `#card=<id>` (no `view`) on load/`hashchange` scrolls the card into view (Now, alert strip or grid; a Done-tray or hidden card gets a toast "card is Done/hidden") and applies a 2 s accent highlight ring, then clears the hash. In-page notify highlight = the `seen[id]` rule above.
- Drag handle = card title bar only (body stays text-selectable); resize handle bottom-right.

### Card frame (all panels, Now panels, fullscreen)
- Title bar: title (truncate, tooltip), **relative "updated 2h ago"** (muted meta from `updatedAt`; native `title` tooltip = absolute local time; one shared 60 s ticker re-renders all instances, paused while the tab is hidden and refreshed on `visibilitychange`; formats: `just now`, `Nm ago`, `Nh ago`, `Nd ago`), priority marker (≥ threshold only), actions on hover/focus (always visible on touch-less focus): fullscreen, Done, hide, overflow-free (4 buttons max). Body scrolls internally (`overflow:auto`), never grows the card (crowding guard).
- **Broken** (D19, `status:'broken'`): negative-tinted frame, icon, reason text (`message`), `updatedAt`/file hint if provided; **no data region ever rendered**. Hide and Done stay available; Done on Broken allowed (02 acks by `updatedAt`).
- **Notify highlight**: a `notify` card whose `updatedAt` ≠ locally recorded `seen[id]` shows accent ring + dot, clears on click/focus or 1 s of ≥50% viewport visibility, then writes `seen[id]` (localStorage, try/catch). First visit ever: all notify cards unseen. In-page only; OS toast = 05.
- **Link affordance**: shell provides `<CardLink href>` (used by 04; every agent-provided link is clickable). `http|https|mailto` open `target=_blank rel="noopener noreferrer"`; `ms-outlook:` opens via a plain anchor (OS handler; no `target`). Trailing ↗ glyph always visible (muted-tinted), full on hover, `focus-visible` ring. Only schemes the 01 allowlist allows (`http`, `https`, `mailto`, `ms-outlook`) render as anchors (defence in depth re-check; `javascript:`, `data:`, `file:`, anything else → plain text, never an anchor).
  - **Visited indication (Glance borrow, pure CSS `:visited`, no JS/state)**: link text and ↗ use accent (`--primary`) while unvisited (`a:not(:visited)`), muted text colour once visited, ↗ tinted the same way. Privacy limits: browsers only expose colour for `:visited` (no layout/opacity), so only colour changes; `mailto:` and `ms-outlook:` are never reported visited (stay accent); `:visited` also resets when the user clears history; per-row dimming is [DEFERRED] (needs JS-tracked seen links, see README deferred list).
  - Long link text uses the shared 2-line clamp + `title` tooltip (04 shared styles).
- **Spinner delay**: any loading spinner (initial load, refetch, mutation in flight) renders only after 150 ms; faster completions show none (no flash).
- **Motion on change**: card whose `updatedAt` changed since previous snapshot gets a 600 ms accent background fade; mounting cards fade/scale-in 120 ms; all disabled under `prefers-reduced-motion`.

### Hidden & Done recovery
Hide = `PUT /api/cards/:id/hidden`; unhide only via header `Hidden (n)` popover (list of titles with Unhide buttons) or search results ("Hidden" badge, Unhide action). Unhidden card returns to its stored slot (or auto-placement if none). Done recoverable via tray chip. Both counts visible in UI at all times when non-zero.

### Global search (D24)
Header input (`/`, `S` (when focus is not in an input/textarea/contenteditable) or `Ctrl/Cmd+K` focuses; `Esc` clears the text, a second `Esc` (or Esc on empty) blurs). Case-insensitive, whitespace-split tokens, AND semantics, over: `title` + registry `searchText(data)` per type (Broken: title + message only). Scope = every card in snapshot (alerts, Now, grid, tray, hidden); window-hidden cards are not in the snapshot so not searchable (02).
- **Effect**: no reflow. Non-matching cards dim to 30% and are `inert`-free but de-emphasised; matches keep full opacity with accent outline; header shows `n matches`; Enter/Shift+Enter cycles matches (scroll + focus). Tray/hidden matches listed in the search dropdown with open/unhide.
- **Interplay with 04's table search**: shell passes the global string as prop `query`; table (and list) *highlight and pre-filter rows* by it; the table's own box applies *additionally* (AND). Clearing global clears the pre-filter only. Fullscreen inherits both.

### Theme
Glance-style tokens (D25): per theme `--bg: H S L`, `--primary: H S L`, `--positive`, `--negative` (raw triples), plus `--contrast` and `--text-sat` multipliers and `light` flag. A small derivation layer (CSS `calc()` on the triples; no JS runtime) produces `--surface-1/2`, `--border`, `--text`, `--text-muted`, `--accent-soft`, `--ring`: surface steps move L away from bg by `step × contrast` (toward lighter in dark, darker in light); text sat = base × `--text-sat`.
| Preset | bg | primary | positive | negative | contrast |
|---|---|---|---|---|---|
| dark (default) | `230 15 14` | `256 85 72` | `150 55 52` | `4 75 62` | 1.1 |
| light | `220 23 96` | `220 85 50` | `150 60 36` | `4 70 48` | 1.0 |
(Values are starting points, tuned to AA contrast in tests.) One accent = `--primary`; state colours only for kpi/Broken/alerts.
- **Selection**: default `system` (`prefers-color-scheme`); header toggle cycles system → light → dark; stored in localStorage; inline script in `index.html` sets `data-theme` before first paint (no flash).
- **Type**: system-ui stack (no webfont, works offline), 13px base / 12px meta, `font-variant-numeric: tabular-nums` for numbers, 1.35 line height, 600 weight titles only. Flat cards: 1px border, 8px radius, no shadows except fullscreen.

### Data loading & connection
- Poll `GET /api/snapshot` with `If-None-Match`; interval = `snapshot.config.pollIntervalMs` clamped 15–60 s (default 30 s before first load); immediate refetch on tab regain-visibility and after any mutation; pause while tab hidden *except* one slow tick (60 s) to keep title count fresh.
- 304 → no re-render. Snapshot structurally shared so unchanged cards don't re-render.
- **Optimistic mutations**: done/undone, hide/unhide, tick, layout, list-item action (tick and untick; `complete` write-back and `dismiss`) apply a local patch immediately (the `onItemAction` promise resolves on success, rejects with the server message on rollback/409/500), send with `Content-Type: application/json` + `X-Crontick-Dashboard: 1`, then refetch; on error roll back and show a toast with server `error`. `409` (item action: `updatedAt` mismatch or write-back conflict, 02) → item reverts, silent refetch + toast "card updated, try again". `500` (write-back failed) → item reverts, toast shows the error. On `200` the refetched snapshot carries `item.checked`/`checkedAt` from the file.
- **Server down** (owner decision 2026-10-05; D19 literal): after 2 consecutive failures, or > 2× interval since last success, or a failed first load, the UI shows **only** a clear full-page "Server down" state (icon, "Server down", "Retrying every N s…", hint `crontick-dashboard daemon start`). **No cards, no zones, no cached or stale data, no dimmed grid.** The store drops the last snapshot from memory and discards optimistic patches and pending layout writes; header reduced to theme toggle + red connection dot (search, Hidden popover, badges removed); `document.title` = "Server down"; backoff 5→10→30 s; auto-recovers on first success (full UI returns, no reload).
- Empty state (no cards): short hint showing `crontick-dashboard info` for the feed path.
- Errors in a type component are contained by a per-card error boundary → frame shows "Render error" (not a blank page).

### Accessibility basics
Landmarks (`header`, `main`, zones as `section aria-labelledby`); alert strip `role="region" aria-live="polite"` (new alerts announced); all controls are real `<button>` with `aria-label`; visible `:focus-visible` ring (`--ring`); AA text contrast verified for both presets; reduced-motion respected; fullscreen via modal dialog. Known limit: drag/resize are pointer-only in v1 — [DEFERRED] keyboard move/resize.

## Architecture

### Source layout & build
```
ui/index.html  vite.config.ts  tsconfig.json
ui/src/  main.tsx  App.tsx
  api/      client.ts (fetch+ETag+headers), store.ts (snapshot store, poll, optimistic), types.ts (re-exports)
  zones/    Header, NowZone, AlertStrip, Grid, DoneTray, HiddenPopover, SearchBox
  frame/    CardFrame, BrokenBody, CardLink, ErrorBoundary, Fullscreen
  registry/ registry.ts (client type registry), unknown.tsx
  lib/      placement.ts, search.ts, seen.ts, theme.ts
  theme/    tokens.css, themes.css, base.css
ui/tests/  (vitest)   tests/smoke/ (browser)
```
- Vite `root: ui`, default `build.outDir` (`ui/dist`; tsup `clean` would wipe `dist/`, so 06 copies it after), `base: './'`. 02's `startServer({uiDir})` is given `dist/ui` by 06's CLI (resolved relative to the package). 06's build = `vite build` then `tsup` whose `onSuccess` copies `ui/dist` to `dist/ui`; `package.json files` includes `dist`.
- Dev: `vite dev` proxies `/api` to the port in `daemon.port` / `CRONTICK_DASHBOARD_PORT`.
- Deps: `react`, `react-dom`, `react-grid-layout`; no router, no data-fetching or state lib (store = `useSyncExternalStore`). UI imports 01/02 types with `import type` only, so zod/Node code never enters the bundle.

### Interface consumed from 02 (and assumed)
`GET /api/snapshot` exactly as 02 (incl. Broken `reason`+`message`, `checked`); mutations exactly as 02 §Mutations. Shared DTO types (`Snapshot`, `ViewCard`, `LayoutItem`) live in `src/shared/api-types.ts`, owned by 02, imported with `import type`.

### Interface provided to 04 — client type registry
```ts
// ui/src/registry/registry.ts  (keys are the 01 registry type names)
export interface CardTypeProps<D> {
  card: ViewCard;            // id, kind, title, priority, size, updatedAt, notify, checked?: string[]
  data: D;                   // 01-inferred data type for this type (never present for Broken)
  mode: 'grid' | 'now' | 'alert' | 'fullscreen';
  query: string;             // global search string ('' when none)
  checked: ReadonlySet<string>;  // item.checked (data; includes `complete` write-backs) + snapshot `checked` ids (dismiss) + optimistic
  pending: ReadonlySet<string>;  // item ids with an action request in flight (shell-tracked)
  onItemAction(itemId: string): Promise<void>; // shell does optimistic update, POST, rollback
}
export interface CardTypeDef<D> {
  Component: React.ComponentType<CardTypeProps<D>>;
  searchText(data: D): string;            // everything searchable, flattened
  allowedModes?: Mode[];                  // default: all
}
export function registerCardType<T extends TypeName>(type: T, def: CardTypeDef<DataOf<T>>): void;
```
- 04 calls `registerCardType` once per type from `ui/src/types/<type>/index.ts`; `ui/src/types/index.ts` imports all (the one place to add a type, step 5 of 01's "Adding a type"). A unit test asserts every `listTypes()` name from 01 has a registered def (mirrors 01's test).
- Components own only the card **body**: frame, title, actions, Broken, scrolling, errors are the shell's. They must adapt to container size (CSS container queries) and render compactly in `alert` mode (single line / strip item; 01 restricts alerts to markdown/list/kpi).
- **Unknown type** (registry miss, e.g. server newer than UI, or server tolerated forward-compat type): frame shows "Unsupported type `<t>`" body with title; searchable by title; not Broken-styled.
- Link rendering: use shell `CardLink` (04 must not hand-roll anchors).

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| U1 | Theme engine | CSS variables with HSL triples + calc derivation, no JS | JS theme generator; Tailwind theme | Glance model, few numbers per theme, zero runtime |
| U2 | Theme choice | system default + 3-way toggle, pre-paint script | Dark only; system only | Cheap, no flash |
| U3 | Fonts | system-ui stack | Inter webfont | Offline-safe, no asset to ship, still calm |
| U4 | Grid layout | RGL 12 col, compaction render-only, persist on stop | Free placement w/ holes; persist every change | Gaps from Now/Done would look broken; compaction-derived positions must not overwrite saved slots |
| U5 | Size mapping | S 3×4, M 3×7, L 6×9 | All 6 wide | Narrow–wide–narrow default; compact keeps crowding down |
| U6 | Search | Dim non-matches in place + cycle; no reflow | Filter out; separate results page | Preserves spatial memory; find-in-place |
| U7 | Now panels | Rendered in Now zone, not in grid | Duplicate in both | Matches 02 (`grid` excludes them) and D12 |
| U8 | Data layer | Own `useSyncExternalStore` store | react-query/SWR | One endpoint; ETag + optimistic simple enough |
| U9 | Server-down | Only a "Server down" state, snapshot dropped (owner 2026-10-05) | Dimmed grid + banner | D19: never show old data; nothing stale can leak |
| U13 | Visited links | CSS `:visited` colour only (accent unvisited, muted visited) | JS seen-link store; row dimming | Zero state, Glance-proven; privacy limits accepted; row dim deferred |
| U10 | Fullscreen | `<dialog>` modal + hash | Route; in-grid expand | Free a11y, deep-linkable, no layout change |
| U11 | Alerts | Tick only; no hide/collapse | Same frame as panels | Unmissable (D11) |
| U12 | Tests | vitest (+jsdom, testing-library) for logic/components; one Playwright smoke | Cypress; no smoke | Matches repo; brainstorm Verification asks one smoke |

## Risks / Open Questions
- [RESOLVED: `src/shared/api-types.ts`, owned by 02] was OPEN-1.
- [RESOLVED: 02 snapshot carries Broken `reason` + `message` (`pendingItems` dropped 2026-10-05)] was OPEN-2.
- [RESOLVED: 02 includes `data` for ok cards in every zone] was OPEN-3.
- [RESOLVED: server down = only a "Server down" state, no cards/stale data (owner 2026-10-05, D19)] was OPEN-4; dimmed-grid design dropped.
- [RESOLVED: `#card=<id>` = scroll + highlight, `#card=<id>&view=full` = fullscreen; both specced above] 05 deep-link request.
- [RESOLVED: Vite emits `ui/dist`; 06 copies to `dist/ui`] build handoff.
- [RESOLVED: link allowlist `http|https|mailto|ms-outlook` (owner 2026-10-05), `CardLink` follows 01] was link-scheme open item.
- [RESOLVED: choose react-grid-layout major at task time based on React 19 support; prefer latest stable that supports React 19] `react-grid-layout` major (v1 + `@types` vs v2 hooks API) — pick at task time after checking React 19 support.
- [RESOLVED: Playwright] Smoke runner: Playwright (needs browser download in CI) vs puppeteer-core + system Chrome.
- [RESOLVED: placement in UI, saved via PUT] D21 per 02 Decision 10.
- [DEFERRED] Keyboard move/resize, theme presets, SSE (poll latency), mobile.
- Risk: crowding with many cards — mitigated by compact sizes, collapse, search dim, Done/hide; revisit after 2-week real use.
- Risk: compaction-on-render shifts neighbours when a Now card returns (accepted; slots persisted).

## Reconciliation 01 / 02 (05 = notifications only) (resolved 2026-10-05; follow 01 for card shape, 02 for API)
| Item | Resolution |
|---|---|
| Validator | 02 adopts 01 `validateCardFile`; UI unaffected |
| Now threshold default | 3 (owner 2026-10-05), 02 config `nowPriorityThreshold`; UI reads `snapshot.config` only |
| `show.for` omitted (end of local day) / `show.tz` / alerts honor `show` | resolved 2026-10-05; server-side (02/01); UI unaffected |
| Item `checked` | UI: `item.checked` (incl. `complete` write-backs) OR id in snapshot `checked` (dismiss) OR optimistic |
| Pending items | `pendingItems` removed (TickTick rework 2026-10-05); `pending` prop = in-flight only |
| `size` | UI treats missing as M |
| Alerts | 01 allows markdown/list/kpi only; 04 `allowedModes`; Now alert strip never receives table/media |

## Acceptance Criteria
- `vite build` emits `dist/ui/index.html`; 02 serves it; page loads with no console errors against a fixture feed (smoke: renders one card per fixture type, one Broken card with message and no data, one alert, one Done-chip after clicking Done and reopening it, zero-card empty state).
- Placement test: new ids fill first free slot, existing entries never move; S/M/L defaults correct; layout PUT debounced (one call per burst) and not sent from compaction-only changes.
- Panel in Now is absent from grid; after its window closes it renders at its saved slot.
- Priority ≤1 panel renders as chip, expands on click, collapses again after reload (UI-local).
- Broken fixture never shows `data` content even if the snapshot erroneously includes it.
- Hide → appears in Hidden popover → Unhide restores slot. Tray chip click reopens.
- Global search `dana` dims non-matching cards, matches stay in place, counts match number; table gets `query` prop; Esc clears; layout unchanged.
- Server stopped → within 2 poll intervals the page shows only "Server down": zero card elements in the DOM, no cached titles/data anywhere (assert), no dimmed grid; restart → full UI returns without reload.
- Visited links: CSS rule present (`a:not(:visited)` accent, `:visited` muted, ↗ tinted); `javascript:`/`data:`/`file:` hrefs render as plain text; `mailto:`/`ms-outlook:` anchors render with no `target`/visited styling expectations; `http(s)` get `rel="noopener noreferrer"`.
- Title bar shows "updated 2h ago" for `updatedAt` 2 h in the past, ticks to "3h ago" without refetch (fake timers, 60 s tick), does not tick while `document.hidden`, refreshes on visibility.
- Pressing `S` (not in an input) focuses search, `Esc` blurs; typing `s` inside an input does not steal focus.
- Spinner not rendered for a request resolving in <150 ms; rendered after 150 ms.
- Optimistic failure (mock 500/409) rolls back and toasts.
- Theme: first paint matches `prefers-color-scheme`; toggle persists; no flash; both presets pass AA contrast test for text/muted/primary-on-bg.
- Registry test: every 01 type has a registered def; unknown type renders fallback without crash; a throwing component is contained by the error boundary.
- Axe-style check (vitest + `jest-axe` or equivalent) on shell with fixtures: no critical violations.
