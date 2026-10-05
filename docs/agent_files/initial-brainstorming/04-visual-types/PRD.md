---
status: draft
summary: Five generic card-body React components (markdown, table, list, kpi, media) registered in 03's client registry — safe rendering, deep links, search/filter/sort, optimistic checkboxes.
date: 2026-10-05
---
# PRD: Visual type components (04)
Repo/branch: crontick-dashboard / `initial-brainstorming` · Depends on: 01 (data types, examples), 03 (registry, `CardLink`, frame) · Owns: `ui/src/types/**` (per-type folders + `shared/`), `ui/tests/types/**`

## TL;DR
Five small, domain-agnostic body components. Each renders 01's `data` shape, registers once via 03's `registerCardType`, uses 03's `CardLink` for every link, and adapts to `grid | now | alert | fullscreen`. Agent content is untrusted text: nothing is ever injected as HTML. Compact mode shows the gist (capped); fullscreen shows everything. Deep links (kill criterion, D8) are first-class: a table row or list item with `link` is one click away.

## Problem
Agents write arbitrary rows/text/images. Components must make that readable at a glance, searchable, never crash, never execute agent-supplied markup, and stay calm (D22) — without domain-specific widgets (D7).

## Goals / Non-Goals
Goals: per-type compact + fullscreen behaviour; link handling; `searchText`; empty and large-data states; a11y; fixture-driven tests; a trivial "add a type" path.
Non-Goals: frame/Broken/scroll/error boundary (03); schemas (01); action execution + TickTick (02/05); `embed`, inline video, history viewer, UI→agent inputs, charts/sparklines, editing (D31, futures.md); syntax highlighting; row virtualization lib; keyboard drag.

## Requirements

### Common
- Body only. Fill container, adapt with container queries; no own scroll at card level (shell scrolls), except inner scroll for wide tables/code.
- **Links**: only `CardLink` (03). No hand-rolled `<a>`. No `link` or disallowed scheme → plain text (03 re-checks).
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
- Columns normalised from `string | {key?,label,sort?}`. Cells: string/number/bool/null as **text only** (never markdown/HTML); numbers right-aligned `tabular-nums`; boolean ✓/–; null "–"; compact truncates with ellipsis + `title`, fullscreen wraps.
- **Search**: own box (hidden when `searchable:false`; in compact shown only if rows > 5), substring over `String(cell)`, case-insensitive, whitespace tokens AND — same semantics as global. Applied AND with global `query`. Shows "n of m rows" (`aria-live=polite`).
- **Sort**: header button cycles asc → desc → default (`defaultSort` or source order). Type = explicit `sort`, else inferred per column: ≥80% of non-null cells numeric (number, or string after stripping `, % $ €`) → number; ≥80% ISO-date-like (`YYYY-MM-DD[THH:mm…]`) → date; else text (`localeCompare`, numeric option off). Nulls last in both directions; stable. `aria-sort` set.
- **Filter** (fullscreen only, to keep compact calm): per-column multi-select popover for columns with 2–20 distinct values, values derived from cells; AND across columns; active filters shown as removable chips.
- **Row link**: whole row clickable via a stretched `CardLink` in the first cell (one tab stop, accessible name = row's first two cells), trailing ↗ on hover/focus. Rows without `link` are inert. Selecting text in cells of linked rows is limited — accepted; fullscreen has no workaround in v1.
- **Large data**: compact renders first 50 matching rows + "Show all n in fullscreen"; fullscreen renders 200 and "Show 200 more". Sticky header. Virtualization [DEFERRED] (1 MB file cap bounds rows; revisit if >2k rows janks).
- Empty: "No rows" (muted). `searchText` = column labels + all cells.

### list
- Items: `text`, optional `subtitle`, `link` (text becomes the link), optional `action` → checkbox. No `action` → bullet, no checkbox.
- **Checked** = `item.checked === true` OR `checked.has(item.id)` (shell set: server-confirmed + optimistic). Checked items stay in place (no reorder), muted + strike-through; completed (`ticktick.complete`) and `dismiss` items both stay visible-checked until the agent rewrites the card (answers 02's [OPEN] on dismiss UX). A checked item's checkbox is disabled (no un-complete in v1; TickTick owns that). Header shows "k of n done" and, in fullscreen, a "Hide done" toggle (local).
- **Tri-state feedback** on click: component calls `onItemAction(id)` and tracks per-item `pending` locally: `pending` (spinner, checkbox disabled, `aria-busy`) → resolves → checked via shell set; rejects → `failed` (item unchecked, inline "Couldn’t complete — retry" in negative token, clears on next click or after 8 s). Shell owns optimistic patch, rollback, and toast; 502/409 arrive as rejection.
- **Due date**: 01 has no field. Agents put it in `subtitle`. If an item carries an extra `due` (ISO date/datetime) the list renders it as "Today / Tomorrow / Mon 12 / Overdue 2d" (overdue in `--negative`). [OPEN] 01: promote `due` to the schema?
- Compact: first 100 items then "Show n more"; fullscreen: all up to 200, then "Show more". `alert`: single line per item, first 3 + "+n"; checkbox allowed.
- Empty: `data.emptyText` else "Nothing here". `searchText` = text + subtitle per item.

### kpi
- Layout: label (small, muted), value (large, `tabular-nums`), unit, state icon, trend.
- `value`: number → `Intl.NumberFormat` (locale default); string verbatim, 2-line clamp. Size scales with container query.
- `state` → icon **plus text label** (never colour alone): ok ✅ positive, pending ⏳ (soft pulse), fail ❌ negative, warn ⚠ neutral-warn. Rendered as inline SVG/emoji-safe glyph with `aria-label`.
- `trend`: ▲/▼/– with `delta` (signed). Direction = `dir` else sign of delta. Colour: direction equals `good` (default `up`) → `--positive`, opposite → `--negative`, flat → muted.
- Motion: when `value`/`state` differs from previous render (usePrevious), 200 ms cross-fade of the value. No chart.
- `link` → whole tile via `CardLink`. `alert`: one line `icon label value delta`.
- Missing value (defensive) → "–". `searchText` = label, value, unit, state word. Multi-metric: one metric per card (01 OPEN-5 default).

### media
- `items` (1–50): `<figure>` with `img`, optional `caption`, optional `link` (image becomes `CardLink`). `layout: grid` (default; 2 columns, 16:9 `object-fit:cover`, container-query to 1 column when narrow) or `single` (`contain`).
- Allowed `src`: `http(s)` and `data:image/*` only (01); anything else → placeholder. `loading="lazy"`, `decoding="async"`, `referrerpolicy="no-referrer"` (no leak of dashboard URL/IP-referrer to image hosts), explicit aspect-ratio box to avoid layout shift. GIFs animate (no pause control v1).
- Load error → placeholder with alt/caption text; link still works. `alt` = `alt` else `caption` else "Image".
- Compact: first 6 + "+n in fullscreen"; fullscreen: all, larger. No click-to-zoom (fullscreen is the zoom). No video/embed (non-goals).
- `searchText` = alt + caption.

### Safety & a11y
- URL rules: links = 03 `CardLink` allowlist (`http|https|mailto|ms-outlook`, trailing re-check); images = `safeImageSrc()`; markdown `urlTransform` routed through the same two helpers. Outlook web deep links (`https://outlook.office.com/mail/deeplink/read/…`) work today; `ms-outlook:` depends on 01 OPEN-6.
- Real `<table>/<th scope>`, `<ul>`, native `<input type=checkbox>` with label, `<figure>/<figcaption>`; `:focus-visible` ring; colour never sole signal; sort/filter controls are buttons with labels; axe check per fixture.

## Architecture
```
ui/src/types/
  index.ts                     imports each type (03 hook; the one place to add a type)
  markdown|table|list|kpi|media/ {index.ts (registerCardType), <Name>.tsx, <name>.css?}
  shared/ highlight.tsx  useQueryFilter.ts  safeImageSrc.ts  format.ts (number/date/due)  ShowMore.tsx  matchTokens.ts
ui/tests/types/                vitest + @testing-library/react + jest-axe, fixtures = 01 `templates/*.example.json` + local edge fixtures
```
- Consumes 03: `registerCardType(type,{Component,searchText,allowedModes?})`, `CardTypeProps<D>` = `{card,data,mode,query,checked,onItemAction}`, `CardLink`, theme tokens (`--positive`, `--negative`, `--primary`, surfaces). Consumes 01: per-type `data` types via `import type`, `templates/*.example.json` for tests.
- Provides: 5 registered defs; `matchTokens(text, query)` (shared by `searchText` consumers); contract for 03 that `searchText(data)` is pure/total (never throws).
- **Libraries**: `react-markdown` + `remark-gfm` (AST → React elements, no innerHTML; `skipHtml`, no `rehype-raw`). No table/virtual/highlight libs; table logic is ~150 LOC pure functions (`inferColumnType`, `sortRows`, `filterRows`) unit-tested separately.
- **Add a type (D7, step 5 of 01)**: create `ui/src/types/<t>/` with component + `registerCardType('<t>', …)`, import it in `types/index.ts`, add fixture test from `templates/<t>.example.json`. 03/01 registry-parity tests fail otherwise.

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| V1 | Markdown renderer | react-markdown + remark-gfm, `skipHtml` | marked/markdown-it + DOMPurify; markdown-to-jsx | No HTML string path → XSS-by-construction; GFM tables needed |
| V2 | Raw HTML | Dropped | Sanitized allowlist; escaped display | Files are agent-written; simplest safe |
| V3 | Table row link | Stretched link, whole row | Icon column; per-cell links | Deep link is kill criterion; one tab stop; 01 allows one link per row |
| V4 | Sort typing | Inferred ≥80%, explicit override | Always text; require `sort` | Matches 01; agents won't annotate |
| V5 | Filter | Fullscreen, per-column value multi-select | Free-text per column; compact too | Search covers text; keeps compact calm (D22) |
| V6 | Large tables | Cap 50 compact / paged 200 fullscreen | Virtualize; render all | No dep; file ≤1 MB |
| V7 | Checked state | `item.checked` OR shell set; stays visible, disabled | Remove on done; allow undo | No reorder surprises; undo owned by source |
| V8 | List feedback | Component-local pending/failed + shell optimistic/toast | Shell-only | Spinner/retry belongs next to the item |
| V9 | KPI state | Icon + text, trend colour via `good` | Colour only | a11y; "down is good" for e.g. error counts |
| V10 | Images | http(s)+data:image, lazy, no-referrer | Proxy via server; local files | No server work; privacy |
| V11 | Due date | Render extra `due` if present | Ignore; subtitle only | TickTick use case; cheap |
| V12 | Search interplay | Pre-filter + "show all" escape | Dim only; hard filter | Matches 03; avoids dead card |

## Risks / Open Questions
- [OPEN] **03**: `onItemAction` must reject (Error with server message) on rollback/409/502 and resolve on success; confirm. Also 03 gives both `card.checked: string[]` and `checked: ReadonlySet`; 04 uses only the Set.
- [OPEN] **01**: `due` on list items (optional ISO date) — promote to schema or leave as extra.
- [OPEN] **01/02**: local image files (e.g. recording screenshots on disk). 01 bans `file:`; v1 = remote or `data:` only (1 MB cap). A `<data>/media/` route served by 02 is the likely answer; needs decision.
- [OPEN] **02**: any CSP header must allow `img-src 'self' data: http: https:` or media breaks; confirm no CSP / this one.
- [OPEN] **01 OPEN-6** `ms-outlook:` scheme: 03 already allows it, 01 undecided; 04 follows whichever `CardLink` does.
- [RESOLVED: stays visible, checked, disabled until rewrite] `dismiss` UX (02's open item).
- [RESOLVED: one metric per kpi card] follows 01 OPEN-5 default.
- [DEFERRED] markdown in-body search highlight; table virtualization; GIF pause; image lightbox; syntax highlighting; per-column filter in compact.
- Mismatches found: list `checked` boolean (01) vs id array (02) → union rule above; 03 says alert-mode components render compactly for all types but 01 restricts alerts to markdown/list/kpi → `allowedModes` on table/media; 01 `data:image/*` includes SVG — safe only inside `<img>`, so 04 never inlines SVG.
- Risk: stretched-link rows block text selection; revisit after real use.

## Acceptance Criteria
- Every `templates/*.example.json` renders via its registered component with zero console errors and no axe critical violations; registry test passes for all five types.
- markdown: `<script>`, `<img onerror>`, `[x](javascript:…)`, `![x](file:///…)` render no element/anchor with those values; links get `target=_blank rel="noopener noreferrer"` via `CardLink`; heading `#` is not an h1.
- table: sorts numeric ("9" < "10"), date, text; nulls last; header `aria-sort` correct; search + global `query` AND; 500-row fixture renders ≤50 rows compact and pages in fullscreen; row with `link` has exactly one anchor; zero-match shows "Show all" which restores rows; `searchable:false` hides box.
- list: checkbox only when `action`; click → pending state → checked on resolve; reject → unchecked + failed text; `item.checked:true` initial renders checked; id in `checked` set renders checked; no reordering; empty uses `emptyText`.
- kpi: `delta:-3, good:"down"` renders positive; state shows icon + text; text value ("Deployed") renders; value change triggers fade unless reduced-motion.
- media: non-http(s)/non-image-data src renders placeholder, no `<img>` with that src; images have `loading=lazy` and `referrerpolicy=no-referrer`; broken image shows alt text and link still works; `grid` vs `single` layout.
- `searchText` returns expected flattened text for each example and never throws on empty/extra-key data.
