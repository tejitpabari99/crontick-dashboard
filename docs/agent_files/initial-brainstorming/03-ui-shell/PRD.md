---
status: draft
summary: React/Vite UI shell — HSL theme tokens, header/Now/grid/Done-tray zones, uniform card frame, client type registry, global search, ETag polling, optimistic mutations.
date: 2026-10-05
---
# PRD: UI shell (03)
Repo/branch: crontick-dashboard / `initial-brainstorming` · Depends on: 01 (types only), 02 (HTTP API) · Owns: `ui/**` (Vite root: `index.html`, `src/`, `tests/`, `vite.config.ts`), `tests/smoke/**`, `ui` tsconfig + vitest project

## TL;DR
A single-page React app that renders 02's snapshot: slim header, Now zone, fixed-position react-grid-layout grid, Done tray. Every card sits in one uniform frame (title, fullscreen, Done, hide, Broken, collapsed chip); 04's five type components plug in through a typed client registry. Calm, dense, flat, Glance-derived HSL tokens, one accent, light + dark. Built by Vite to `dist/ui/`, served by 02.

## Problem
Agent-written cards are only valuable if they surface on time, on top, without crowding (kill criteria, §2). The shell must make crowding structurally hard (compact defaults, collapse, no auto-reorder), make failure visible (D19), and give 04 a stable frame so types stay tiny components.

## Goals / Non-Goals
Goals: scope items 1–8 of SP03; spatial memory preserved; every state recoverable (hidden, Done); keyboard/AA basics; works offline from CDNs (no external fonts/scripts).
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
- **Fullscreen**: native `<dialog>` modal (focus trap, Esc closes, restores focus), card rendered at `mode:'fullscreen'`; open state in URL hash `#card=<id>`.
- Drag handle = card title bar only (body stays text-selectable); resize handle bottom-right.

### Card frame (all panels, Now panels, fullscreen)
- Title bar: title (truncate, tooltip), priority marker (≥ threshold only), actions on hover/focus (always visible on touch-less focus): fullscreen, Done, hide, overflow-free (4 buttons max). Body scrolls internally (`overflow:auto`), never grows the card (crowding guard).
- **Broken** (D19, `status:'broken'`): negative-tinted frame, icon, reason text (`message`), `updatedAt`/file hint if provided; **no data region ever rendered**. Hide and Done stay available; Done on Broken allowed (02 acks by `updatedAt`).
- **Notify highlight**: a `notify` card whose `updatedAt` ≠ locally recorded `seen[id]` shows accent ring + dot, clears on click/focus or 1 s of ≥50% viewport visibility, then writes `seen[id]` (localStorage, try/catch). First visit ever: all notify cards unseen. In-page only; OS toast = 05.
- **Link affordance**: shell provides `<CardLink href>` (used by 04): opens `target=_blank rel="noopener noreferrer"`, trailing ↗ icon on hover, `focus-visible` ring. Only schemes the contract allows are rendered as anchors (defence in depth: re-check against `http|https|mailto|ms-outlook`; otherwise plain text).
- **Motion on change**: card whose `updatedAt` changed since previous snapshot gets a 600 ms accent background fade; mounting cards fade/scale-in 120 ms; all disabled under `prefers-reduced-motion`.

### Hidden & Done recovery
Hide = `PUT /api/cards/:id/hidden`; unhide only via header `Hidden (n)` popover (list of titles with Unhide buttons) or search results ("Hidden" badge, Unhide action). Unhidden card returns to its stored slot (or auto-placement if none). Done recoverable via tray chip. Both counts visible in UI at all times when non-zero.

### Global search (D24)
Header input (`/` or `Ctrl/Cmd+K` focuses, `Esc` clears). Case-insensitive, whitespace-split tokens, AND semantics, over: `title` + registry `searchText(data)` per type (Broken: title + message only). Scope = every card in snapshot (alerts, Now, grid, tray, hidden); window-hidden cards are not in the snapshot so not searchable (02).
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
- **Optimistic mutations**: done/undone, hide/unhide, tick, layout, list-item action apply a local patch immediately, send with `Content-Type: application/json` + `X-Crontick-Dashboard: 1`, then refetch; on error roll back and show a toast with server `error`. `409` (item action, `updatedAt` mismatch) → silent refetch + toast "card updated". `502` (e.g. TickTick) → item reverts, toast shows error.
- **Server down** (2 consecutive failures, or > 2× interval since last success): banner "Server unreachable — retrying", connection dot red, grid dimmed to 50% with last-update time; mutations disabled; backoff 5→10→30 s; auto-recovers on first success. (Honors D19 spirit: stale data is never presented as live.)
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
- Vite `root: ui`, `build.outDir: ../dist/ui`, `base: './'`. 02's `startServer({uiDir})` is given `dist/ui` by 06's CLI (resolved relative to the package, like `templates/`). 06's build = `tsup` (server/CLI) + `vite build`; `package.json files` must include `dist/ui`.
- Dev: `vite dev` proxies `/api` to the port in `daemon.port` / `CRONTICK_DASHBOARD_PORT`.
- Deps: `react`, `react-dom`, `react-grid-layout`; no router, no data-fetching or state lib (store = `useSyncExternalStore`). UI imports 01/02 types with `import type` only, so zod/Node code never enters the bundle.

### Interface consumed from 02 (and assumed)
`GET /api/snapshot` as in 02 plus the additions listed under Mismatches; mutations exactly as 02 §Mutations. Shared DTO types (`Snapshot`, `ViewCard`, `LayoutItem`) must live in a type-only module both import — proposed `src/shared/api-types.ts`, owned by 02 [OPEN-1].

### Interface provided to 04 — client type registry
```ts
// ui/src/registry/registry.ts  (keys are the 01 registry type names)
export interface CardTypeProps<D> {
  card: ViewCard;            // id, kind, title, priority, size, updatedAt, notify, checked?: string[]
  data: D;                   // 01-inferred data type for this type (never present for Broken)
  mode: 'grid' | 'now' | 'alert' | 'fullscreen';
  query: string;             // global search string ('' when none)
  checked: ReadonlySet<string>;  // server-confirmed + optimistic item ids
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
| U9 | Server-down | Dim + banner, mutations off | Hide everything; keep silently | Never present stale as live |
| U10 | Fullscreen | `<dialog>` modal + hash | Route; in-grid expand | Free a11y, deep-linkable, no layout change |
| U11 | Alerts | Tick only; no hide/collapse | Same frame as panels | Unmissable (D11) |
| U12 | Tests | vitest (+jsdom, testing-library) for logic/components; one Playwright smoke | Cypress; no smoke | Matches repo; brainstorm Verification asks one smoke |

## Risks / Open Questions
- [OPEN-1] Shared DTO types module location/owner (02 proposes inline snapshot shape only). Default: `src/shared/api-types.ts` by 02.
- [OPEN-2] 02 snapshot must include, for `status:'broken'`, a human `message` (01 `ValidationResult.message`) and `reason` as 01 `BrokenReason` code; currently only `reason?`. Default assumed: both.
- [OPEN-3] Do tray and hidden cards carry `data` in `cards`? Needed for search-by-content and instant reopen/unhide. Default assumed: yes for ok cards.
- [OPEN-4] Server-down: dim-and-keep (chosen) vs blank grid; owner call given D19 wording.
- [OPEN-5] `react-grid-layout` major (v1 + `@types` vs v2 hooks API) — pick at task time after checking React 19 support.
- [OPEN-6] Smoke runner: Playwright (needs browser download in CI) vs puppeteer-core + system Chrome.
- [RESOLVED: placement in UI, saved via PUT] D21 per 02 Decision 10.
- [DEFERRED] Keyboard move/resize, theme presets, SSE (poll latency), mobile.
- Risk: crowding with many cards — mitigated by compact sizes, collapse, search dim, Done/hide; revisit after 2-week real use.
- Risk: compaction-on-render shifts neighbours when a Now card returns (accepted; slots persisted).

## Mismatches 01 vs 02 relevant here (follow 01 for card shape, 02 for API)
| Item | 01 | 02 | Handling |
|---|---|---|---|
| Validator | `validateCardFile(text,{filename}) → {ok,card,warnings} \| {broken,reason,message,issues,id?}` | assumes `validateCardText → {ok:false,reason,partial}` | 02 must adapt to 01; UI unaffected [OPEN-2 for snapshot fields] |
| Now threshold default | 4 | 3 | 02 owns config; UI reads `config.nowPriorityThreshold` only [OPEN] 02/01 reconcile |
| `show.for` omitted | OPEN-3 (24h?) | end-of-day | server-side; UI unaffected |
| Item `checked` | per-item initial boolean | `checked?: string[]` ids | UI: checked = item.checked OR id in snapshot `checked` OR optimistic |
| `size` | default `M` | `size?` optional | UI treats missing as M |
| Alerts honor `show` | OPEN-4 | window applies to all | server-side |

## Acceptance Criteria
- `vite build` emits `dist/ui/index.html`; 02 serves it; page loads with no console errors against a fixture feed (smoke: renders one card per fixture type, one Broken card with message and no data, one alert, one Done-chip after clicking Done and reopening it, zero-card empty state).
- Placement test: new ids fill first free slot, existing entries never move; S/M/L defaults correct; layout PUT debounced (one call per burst) and not sent from compaction-only changes.
- Panel in Now is absent from grid; after its window closes it renders at its saved slot.
- Priority ≤1 panel renders as chip, expands on click, collapses again after reload (UI-local).
- Broken fixture never shows `data` content even if the snapshot erroneously includes it.
- Hide → appears in Hidden popover → Unhide restores slot. Tray chip click reopens.
- Global search `dana` dims non-matching cards, matches stay in place, counts match number; table gets `query` prop; Esc clears; layout unchanged.
- Server stopped → banner within 2 poll intervals, mutations disabled; restart → recovers without reload.
- Optimistic failure (mock 502/409) rolls back and toasts.
- Theme: first paint matches `prefers-color-scheme`; toggle persists; no flash; both presets pass AA contrast test for text/muted/primary-on-bg.
- Registry test: every 01 type has a registered def; unknown type renders fallback without crash; a throwing component is contained by the error boundary.
- Axe-style check (vitest + `jest-axe` or equivalent) on shell with fixtures: no critical violations.
