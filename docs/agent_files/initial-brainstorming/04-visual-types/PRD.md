---
status: draft
summary: Five generic card-body React components (markdown, table, list, kpi, media) registered in 03's client registry — safe rendering, deep links, search/filter/sort, optimistic checkboxes.
date: 2026-10-05
---
# PRD: Visual type components (04)
Repo/branch: crontick-dashboard / `initial-brainstorming` · Depends on: 01 (data types, examples), 03 (registry, `CardLink`, frame) · Owns: `ui/src/types/**` (per-type folders + `shared/`), `ui/tests/types/**`

## TL;DR
Five small, domain-agnostic body components. Each renders 01's `data` shape, registers once via 03's `registerCardType`, uses 03's `CardLink` for every link, and adapts to `grid | now | alert | fullscreen`. Agent content is untrusted text: nothing is ever injected as HTML. Compact mode shows the gist (capped); fullscreen shows everything. Deep links (kill criterion, D8) are first-class: every agent-provided link is clickable: a table row, table cell, list item (plus secondary `links[]`) or kpi tile with a link is one click away.

## Problem
Agents write arbitrary rows/text/images. Components must make that readable at a glance, searchable, never crash, never execute agent-supplied markup, and stay calm (D22) — without domain-specific widgets (D7).

## Goals / Non-Goals
Goals: per-type compact + fullscreen behaviour; link handling; `searchText`; empty and large-data states; a11y; fixture-driven tests; a trivial "add a type" path.
Non-Goals: frame/Broken/scroll/error boundary (03); schemas (01); action execution (02 writes `complete` back to the card file; the dashboard never talks to TickTick); `embed`, inline video, history viewer, UI→agent inputs, charts/sparklines, editing (D31, futures.md); syntax highlighting; row virtualization lib; keyboard drag.

## Requirements

### Common
- Body only. Fill container, adapt with container queries; no own scroll at card level (shell scrolls), except inner scroll for wide tables/code.
- **Links**: only `CardLink` (03), which applies visited colouring (accent unvisited / muted visited, ↗ tinted) to every link. No hand-rolled `<a>`. No `link` or disallowed scheme (allowlist `http|https|mailto|ms-outlook`; `javascript:`/`data:`/`file:`/others rejected) → plain text (03 re-checks).
- **Truncation**: shared styles `.clamp-1` (single-line ellipsis) and `.clamp-2` (`-webkit-line-clamp: 2`); any clamped text carries a native `title` tooltip with the full text. Used for list `text`/`subtitle`, table cells (compact), kpi string values, link text.
- **"+N more" (compact only)**: when a table/list caps its rows/items in grid/now mode, a final row "+N more" (a button, not a link) opens that card's fullscreen (`#card=<id>&view=full`, via 03). No inline expand/collapse (body scroll + fullscreen rule, 03). Fullscreen has its own paging (below).
- **Query** (`query` prop from global search, D24): table and list pre-filter rows/items and highlight with `<mark>` (React nodes, never HTML strings); markdown/kpi/media do not filter (shell dims the card). If a pre-filter yields zero rows, show "No rows match “q” (n hidden) — Show all" (local override until query changes) so a title-only match isn't a dead card.
- **Modes**: `alert` only for markdown/list/kpi (01); table/media register `allowedModes: ['grid','now','fullscreen']`.
- **Compact vs fullscreen state is not shared** (separate mounts); sort/search/filter are local, never persisted.
- Motion (D25): only value cross-fade (kpi), check-off transition (list); all off under `prefers-reduced-motion`. Card-level change fade is 03's.

### markdown
- Renders `data.text` (CommonMark+GFM: tables, strikethrough, task lists (read-only, disabled), autolinks).
- Raw HTML is **dropped** (not escaped-and-shown, not rendered). No `dangerouslySetInnerHTML` anywhere.
- Links → `CardLink`; images → safe-image rules (below), lazy, `max-width:100%`; relative/hash links → plain text.
- Headings demoted (card title is h2): `#`→h3 style … `######`→h6; code blocks mono, `overflow:auto`, no highlighting; GFM tables wrapped in horizontal scroll.
- `alert`: first paragraph as plain text, 2-line clamp. Compact grid: full render (shell scrolls). Empty text → muted "(empty)".
- `searchText` = `text`. No in-body highlight [DEFERRED].

### table
- Columns normalised from `string | {key?,label,sort?}`. Cells: string/number/bool/null, or a cell object `{text, link?}`, as **text only** (never markdown/HTML); `cellText(cell)` (01) gives the displayed/searched/sorted text; numbers right-aligned `tabular-nums`; boolean ✓/–; null "–"; compact truncates with ellipsis + `title`, fullscreen wraps. A cell with `link` renders its text through `CardLink` (clickable, visited colouring, ↗ on hover/focus).
- **Search**: own box (hidden when `searchable:false`; in compact shown only if rows > 5), substring over `String(cellText(cell))`, case-insensitive, whitespace tokens AND — same semantics as global. Applied AND with global `query`. Shows "n of m rows" (`aria-live=polite`).
- **Sort**: header button cycles asc → desc → default (`defaultSort` or source order). Type = explicit `sort`, else inferred per column: ≥80% of non-null cells numeric (number, or string after stripping `, % $ €`) → number; ≥80% ISO-date-like (`YYYY-MM-DD[THH:mm…]`) → date; else text (`localeCompare`, numeric option off). Nulls last in both directions; stable. `aria-sort` set.
- **Filter** (fullscreen only, to keep compact calm): per-column multi-select popover for columns with 2–20 distinct values, values derived from cells; AND across columns; active filters shown as removable chips.
- **Row link + cell links coexist**: whole row clickable via a stretched `CardLink` in the first cell (`::after` overlay, `position:absolute; inset:0` on the row; accessible name = row's first two cells), trailing ↗ on hover/focus. Cell links are `position:relative; z-index:1` above the overlay so a click on a cell link follows only the cell link and never the row link (and vice versa); both are separate tab stops (row link first). Rows without `link` are inert (cell links still work). Selecting text in cells of linked rows is limited — accepted. Example: email table row = row `link` "open email" + a cell `{text:"Unsubscribe", link}`.
- **Large data**: compact renders first 50 matching rows + "+N more" (opens fullscreen); fullscreen renders 200 and "Show 200 more". Sticky header. Virtualization [DEFERRED] (1 MB file cap bounds rows; revisit if >2k rows janks).
- Empty: "No rows" (muted). `searchText` = column labels + all cells.

### list
- Items: `text`, optional `subtitle`, `link` (text becomes the link), optional `links[]` (secondary links rendered as small `CardLink` chips after the text, e.g. "Unsubscribe"; they sit beside, not inside, the main link so both stay clickable), optional `due`, optional `action` → checkbox. No `action` → bullet, no checkbox. `text`/`subtitle` use the 2-line clamp + `title` tooltip.
- **Checked** = `item.checked === true` OR `checked.has(item.id)` (shell set: server-confirmed + optimistic). Checked items stay in place (no reorder), muted + strike-through; `complete` (written back to the card file by 02) and `dismiss` items both stay visible-checked until the agent rewrites the card. **`complete` items can be unticked** (checkbox stays enabled; calls `onItemAction` with untick → 02 sets `checked:false`, clears `checkedAt`); `dismiss` items are one-way (checkbox disabled once checked). Header shows "k of n done" and, in fullscreen, a "Hide done" toggle (local).
- **Tri-state feedback** on click: component calls `onItemAction(id)` and tracks per-item `pending` (shell `pending` set = in-flight): `pending` (checkbox disabled, `aria-busy`; spinner only after 150 ms, 03) → resolves → checked via shell set (optimistic first, then confirmed from `item.checked` in the refetched snapshot); rejects → `failed` (item reverts, inline "Couldn’t save — retry" in negative token, clears on next click or after 8 s). Shell owns optimistic patch, rollback, and toast; 409 (card changed / write-back conflict) and 500 arrive as rejection.
- **Due date** (01 `due`, ISO date or datetime): rendered after the text as "Today / Tomorrow / Mon 12 / Overdue 2d" (date-only = calendar day in `config.timezone`; datetime shows time when today). Overdue (before now, or before today for date-only) and unchecked → `--negative` + "Overdue" word (never colour alone); checked items are muted regardless. Which tasks appear is the agent's choice (important ones only); the dashboard never queries TickTick.
- Compact: first 100 items then "+N more" (opens fullscreen); fullscreen: all up to 200, then "Show more". `alert`: single line per item, first 3 + "+n"; checkbox allowed.
- Empty: `data.emptyText` else "Nothing here". `searchText` = text + subtitle per item.

### kpi
- **Several metrics per card**: `data.items: KpiMetric[]` (01 normalizes the flat single-metric form to `items` of length 1, so the component only handles `items`). Each metric = one tile: label (small, muted), value (large, `tabular-nums`), unit, state icon, trend, optional `link` (whole tile via `CardLink`).
- **Layout**: tiles in a CSS grid `repeat(auto-fit, minmax(…, 1fr))` driven by container queries. Compact (grid/now): 1 tile = single large tile (previous look); 2–4 = one wrapping row of compact tiles; more than 4 → first 4 + "+N more" (opens fullscreen). Fullscreen: all tiles, larger, grid wraps (up to 12). `alert` mode: one line per strip, `icon label value delta` per metric, wrapping, first 3 + plain-text "+N" (alerts have no fullscreen).
- `value`: number → `Intl.NumberFormat` (locale default); string verbatim, 2-line clamp. Size scales with container query.
- `state` → icon **plus text label** (never colour alone): ok ✅ positive, pending ⏳ (soft pulse), fail ❌ negative, warn ⚠ neutral-warn. Rendered as inline SVG/emoji-safe glyph with `aria-label`.
- `trend`: ▲/▼/– with `delta` (signed). Direction = `dir` else sign of delta. Colour: direction equals `good` (default `up`) → `--positive`, opposite → `--negative`, flat → muted.
- Motion: when `value`/`state` differs from previous render (usePrevious), 200 ms cross-fade of the value. No chart.
- Missing value (defensive) → "–". `searchText` = label, value, unit, state word of every metric.

### media
- `items` (1–50): `<figure>` with `img`, optional `caption`, optional `link` (image becomes `CardLink`). `layout: grid` (default; 2 columns, 16:9 `object-fit:cover`, container-query to 1 column when narrow) or `single` (`contain`).
- Allowed `src`: `http(s)` and `data:image/*` only (01); anything else → placeholder. `loading="lazy"`, `decoding="async"`, `referrerpolicy="no-referrer"` (no leak of dashboard URL/IP-referrer to image hosts), explicit aspect-ratio box to avoid layout shift. GIFs animate (no pause control v1).
- Load error → placeholder with alt/caption text; link still works. `alt` = `alt` else `caption` else "Image".
- Compact: first 6 + "+N more" (opens fullscreen); fullscreen: all, larger. No click-to-zoom (fullscreen is the zoom). No video/embed (non-goals).
- `searchText` = alt + caption.

### Safety & a11y
- URL rules: links = 03 `CardLink` allowlist (01: `http|https|mailto|ms-outlook`; `javascript:`, `data:`, `file:`, others rejected; trailing re-check); images = `safeImageSrc()` (`http(s)` and `data:image/*` only; no local files in v1); markdown `urlTransform` routed through the same two helpers. Outlook web deep links (`https://outlook.office.com/mail/deeplink/read/…`) and `ms-outlook:` both work.
- Real `<table>/<th scope>`, `<ul>`, native `<input type=checkbox>` with label, `<figure>/<figcaption>`; `:focus-visible` ring; colour never sole signal; sort/filter controls are buttons with labels; axe check per fixture.

## Architecture
```
ui/src/types/
  index.ts                     imports each type (03 hook; the one place to add a type)
  markdown|table|list|kpi|media/ {index.ts (registerCardType), <Name>.tsx, <name>.css?}
  shared/ highlight.tsx  useQueryFilter.ts  safeImageSrc.ts  format.ts (number/date/due)  ShowMore.tsx  matchTokens.ts
ui/tests/types/                vitest + @testing-library/react + jest-axe, fixtures = 01 `templates/*.example.json` + local edge fixtures
```
- Consumes 03: `registerCardType(type,{Component,searchText,allowedModes?})`, `CardTypeProps<D>` = `{card,data,mode,query,checked,pending,onItemAction}`, `CardLink`, theme tokens (`--positive`, `--negative`, `--primary`, surfaces). Consumes 01: per-type `data` types via `import type`, `templates/*.example.json` for tests.
- Provides: 5 registered defs; `matchTokens(text, query)` (shared by `searchText` consumers); contract for 03 that `searchText(data)` is pure/total (never throws).
- **Libraries**: `react-markdown` + `remark-gfm` (AST → React elements, no innerHTML; `skipHtml`, no `rehype-raw`). No table/virtual/highlight libs; table logic is ~150 LOC pure functions (`inferColumnType`, `sortRows`, `filterRows`) unit-tested separately.
- **Add a type (D7, step 5 of 01)**: create `ui/src/types/<t>/` with component + `registerCardType('<t>', …)`, import it in `types/index.ts`, add fixture test from `templates/<t>.example.json`. 03/01 registry-parity tests fail otherwise.

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| V1 | Markdown renderer | react-markdown + remark-gfm, `skipHtml` | marked/markdown-it + DOMPurify; markdown-to-jsx | No HTML string path → XSS-by-construction; GFM tables needed |
| V2 | Raw HTML | Dropped | Sanitized allowlist; escaped display | Files are agent-written; simplest safe |
| V3 | Table links | Stretched row link + optional per-cell links above it (z-index) | Icon column; cells only | Deep link is kill criterion; extra links ("Unsubscribe") without a new schema |
| V4 | Sort typing | Inferred ≥80%, explicit override | Always text; require `sort` | Matches 01; agents won't annotate |
| V5 | Filter | Fullscreen, per-column value multi-select | Free-text per column; compact too | Search covers text; keeps compact calm (D22) |
| V6 | Large tables | Cap 50 compact / paged 200 fullscreen | Virtualize; render all | No dep; file ≤1 MB |
| V7 | Checked state | `item.checked` OR shell set; stays visible; `complete` untickable, `dismiss` one-way | Remove on done | No reorder surprises; file write-back is reversible until the agent acts |
| V8 | List feedback | Component-local pending/failed + shell optimistic/toast | Shell-only | Spinner/retry belongs next to the item |
| V9 | KPI state | Icon + text, trend colour via `good` | Colour only | a11y; "down is good" for e.g. error counts |
| V10 | Images | http(s)+data:image, lazy, no-referrer | Proxy via server; local files | No server work; privacy |
| V11 | Due date | Render schema `due` (relative, overdue styling) | Ignore; subtitle only | Owner decision 2026-10-05; cheap |
| V13 | Several kpis | `items` tiles row/grid | One per card | Owner decision 2026-10-05 |
| V12 | Search interplay | Pre-filter + "show all" escape | Dim only; hard filter | Matches 03; avoids dead card |

## Risks / Open Questions
- [RESOLVED: 03 optimistic-mutation rule: `onItemAction` resolves on success (incl. queued/pending), rejects with Error(server message) on rollback/409/502; 04 uses only the `checked`/`pending` Sets] .
- [RESOLVED: `due` is a list-item schema field in 01; 04 renders it (owner 2026-10-05)].
- [DEFERRED] Local image files: v1 = `http(s)` or `data:image` only (owner 2026-10-05); a `<data>/media/` route is a futures item.
- [RESOLVED: 02 sends no CSP header in v1 (loopback, agent content is rendered as inert React nodes); if added later it must allow `img-src 'self' data: http: https:`] .
- [RESOLVED: `ms-outlook` allowlisted in 01 (owner 2026-10-05); `CardLink` follows] was 01 OPEN-6.
- [RESOLVED: stays visible, checked, disabled until rewrite] `dismiss` UX (02's open item).
- [RESOLVED: several metrics per kpi card via `items` (owner 2026-10-05)].
- [DEFERRED] markdown in-body search highlight; table virtualization; GIF pause; image lightbox; syntax highlighting; per-column filter in compact.
- [RESOLVED: `pendingItems`/clock badge dropped with the TickTick rework (2026-10-05); `pending` = in-flight only].
- Mismatches found (all reconciled): list `checked` boolean (01) vs id array (02) → union rule above; 03 says alert-mode components render compactly for all types but 01 restricts alerts to markdown/list/kpi → `allowedModes` on table/media; 01 `data:image/*` includes SVG — safe only inside `<img>`, so 04 never inlines SVG.
- Risk: stretched-link rows block text selection; revisit after real use.

## Acceptance Criteria
- Every `templates/*.example.json` renders via its registered component with zero console errors and no axe critical violations; registry test passes for all five types.
- markdown: `<script>`, `<img onerror>`, `[x](javascript:…)`, `![x](file:///…)` render no element/anchor with those values; links get `target=_blank rel="noopener noreferrer"` via `CardLink`; heading `#` is not an h1.
- table links: a row with `link` and a cell `{text,link}` has two anchors; clicking the cell link does not trigger the row link (assert hrefs/click targets); cell `javascript:` renders plain text; cell object text is searched and sorted.
- list: `due` yesterday unchecked shows "Overdue 1d" in negative token; today/tomorrow labels; checked overdue not styled negative; `links[]` render as separate anchors; `complete` checked item can be unticked (calls `onItemAction`), `dismiss` checked is disabled; long text clamps to 2 lines with `title`.
- kpi `items` of 1/3/6 render single tile / row / first 4 + "+N more"; fullscreen shows all; flat-form fixture (normalized) renders same as `items` form.
- "+N more" in compact table/list/kpi/media opens fullscreen (`view=full` hash) and is a button.
- table: sorts numeric ("9" < "10"), date, text; nulls last; header `aria-sort` correct; search + global `query` AND; 500-row fixture renders ≤50 rows compact and pages in fullscreen; row with `link` has exactly one anchor; zero-match shows "Show all" which restores rows; `searchable:false` hides box.
- list: checkbox only when `action`; click → in-flight state → checked on resolve; reject → unchecked + failed text; `item.checked:true` initial renders checked; id in `checked` set renders checked; no reordering; empty uses `emptyText`.
- kpi: `delta:-3, good:"down"` renders positive; state shows icon + text; text value ("Deployed") renders; value change triggers fade unless reduced-motion.
- media: non-http(s)/non-image-data src renders placeholder, no `<img>` with that src; images have `loading=lazy` and `referrerpolicy=no-referrer`; broken image shows alt text and link still works; `grid` vs `single` layout.
- `searchText` returns expected flattened text for each example and never throws on empty/extra-key data.
