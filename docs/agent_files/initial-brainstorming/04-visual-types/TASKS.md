---
status: done
summary: 10 commit-sized tasks building five card-body components (markdown, table, list, kpi, media) on shared helpers, then registering them and activating 03's registry-completeness test.
date: 2026-10-05
---
# Tasks: Visual type components (04)
Source of truth: [PRD.md](PRD.md). Five domain-agnostic React bodies registered through 03's `registerCardType`, rendering 01's `data` shapes with `CardLink` for every link and never injecting HTML. No PRD `[OPEN]` items remain. Fixtures come from 01#7's `templates/*.example.json` plus local edge fixtures; each type registers in its own folder, and 10 wires the import hub.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Shared helpers and styles | 03#1, 03#5, 03#10, 01#2 | done |
| 2 | markdown type | 1, 01#4 | done |
| 3 | Table pure logic | 1, 01#5 | done |
| 4 | table component | 3, 03#6, 03#10 | done |
| 5 | table fullscreen filter | 4 | done |
| 6 | list rendering, due, links | 1, 01#5 | done |
| 7 | list item actions | 6, 03#3 | done |
| 8 | kpi type | 1, 01#4 | done |
| 9 | media type | 1, 01#4 | done |
| 10 | Registration hub, fixtures, a11y, registry test | 2, 4, 5, 7, 8, 9, 01#7, 03#5 | done |

## Task 1 — Shared helpers and styles
What it is / what it means: the common layer under `ui/src/types/shared/` (Common, Safety, V10, V11).
What changes at a high level: `matchTokens(text, query)` (case-insensitive, whitespace AND, same as global search), `highlight` (`<mark>` React nodes only), `useQueryFilter` with the "show all" local override that resets when the query changes, `safeImageSrc()` (`http(s)` and `data:image/*` only), `format.ts` (locale number format; due labels Today/Tomorrow/Mon 12/Overdue Nd in `config.timezone`), `ShowMore` ("+N more" button that sets `#card=<id>&view=full` via 03#10, plus fullscreen paging variant), and `.clamp-1`/`.clamp-2` styles with `title` helper. Reduced-motion CSS guard.
Done when: unit tests cover token matching, highlight nodes, override reset, image-src allow/deny (`file:`, `javascript:`, other `data:`), due labels across date-only/datetime/timezone, and the ShowMore button hash.

## Task 2 — markdown type
What it is / what it means: markdown body (V1, V2) with safety by construction.
What changes at a high level: `react-markdown` + `remark-gfm`, `skipHtml`, no `rehype-raw`, no `dangerouslySetInnerHTML`. Links through `CardLink`; `urlTransform` and images routed through the two URL helpers; relative/hash links plain text; headings demoted (`#` is h3 style); code and GFM tables with inner horizontal scroll; read-only disabled task lists. `alert` mode shows first paragraph as plain text with 2-line clamp; empty shows "(empty)". Module exports `searchText = text` and a def with `registerCardType` call (not yet imported by the hub).
Done when: tests assert `<script>`, `<img onerror>`, `[x](javascript:…)` and `![x](file:///…)` yield no such element or anchor, links carry `target=_blank rel="noopener noreferrer"`, no h1, alert clamp, empty state, and `searchText` totality.

## Task 3 — Table pure logic
What it is / what it means: the ~150 LOC pure functions behind the table (V4, V6), tested separately.
What changes at a high level: column normalisation from `string | {key?,label,sort?}`, `inferColumnType` (≥80% numeric after stripping `, % $ €`, ≥80% ISO-date-like, else text; explicit `sort` wins), `sortRows` (stable, nulls last both directions, `localeCompare` without numeric option, `defaultSort`), `filterRows` (own search AND global query, using 01's `cellText`), and distinct-value derivation for filters (2-20 values). `searchText` = column labels + all cells.
Done when: unit tests cover numeric "9" < "10", dates, text, nulls last, stability, cell-object text sorted and searched, AND semantics, and `searchText` on empty or extra-key data.

## Task 4 — table component
What it is / what it means: the table body UI (Common, table section, V3, V6).
What changes at a high level: real `<table>/<th scope>`, number/bool/null rendering, `aria-sort` header buttons cycling asc, desc, default; own search box (hidden when `searchable:false`, compact only if rows > 5) with live "n of m rows"; stretched row `CardLink` plus cell-level `CardLink`s above it (z-index) as separate tab stops; compact cap 50 rows with "+N more", fullscreen pages 200 with "Show 200 more"; sticky header; zero-match "Show all"; "No rows" empty; `allowedModes` excludes `alert`.
Done when: tests assert a row with `link` has one anchor, row plus cell link yields two anchors with correct hrefs and click targets, cell `javascript:` is plain text, 500-row fixture renders ≤50 compact and pages in fullscreen, `aria-sort`, `searchable:false`, and Show all.

## Task 5 — table fullscreen filter
What it is / what it means: per-column filter, fullscreen only (V5).
What changes at a high level: a multi-select popover per eligible column (2-20 distinct values), AND across columns, removable chips for active filters; absent in compact; local, never persisted.
Done when: tests show the popover only in fullscreen and only for eligible columns, AND filtering, chip removal restoring rows, and counts updating in the live region.

## Task 6 — list rendering, due, links
What it is / what it means: static list body (list section, V11) before interactivity.
What changes at a high level: `<ul>` with bullets, `text` as `CardLink` when `link`, small `CardLink` chips for `links[]` beside it, `subtitle`, 2-line clamp with `title`, due label with `--negative` plus "Overdue" word for unchecked overdue (checked muted), checked styling from `item.checked` or the `checked` set (no reorder), "k of n done" header, query pre-filter with highlight and Show all, compact cap 100 and `alert` mode (first 3 plus "+n", one line each), fullscreen up to 200 with "Show more" and local "Hide done", `emptyText` fallback, `searchText`.
Done when: tests cover yesterday "Overdue 1d" negative styling, today/tomorrow, checked overdue unstyled, separate anchors for `links[]`, clamp with `title`, no reordering, empty text, caps and alert layout.

## Task 7 — list item actions
What it is / what it means: checkbox behavior with tri-state feedback (V7, V8).
What changes at a high level: checkbox only when `action`; click calls `onItemAction(id)` with untick for `complete`; shell `pending` set disables it with `aria-busy` (spinner after 150 ms via 03#2 helper); resolve leads to checked from the shell set; rejection shows inline "Couldn't save — retry" in the negative token, cleared on next click or after 8 s; `dismiss` checked is disabled, `complete` stays untickable; check-off transition off under reduced motion. Consumes only the `checked`/`pending` Sets per the resolved 03 mutation rule.
Done when: tests with a mocked `onItemAction` cover in-flight, resolve, reject plus failed text and 8 s clear, initial `item.checked`, set-driven checked, untick call, dismiss disabled, and no checkbox without `action`.

## Task 8 — kpi type
What it is / what it means: multi-metric tiles (V9, V13).
What changes at a high level: handles only `data.items`; container-query CSS grid; compact 1 tile large, 2-4 compact row, >4 first 4 plus "+N more" button; fullscreen all tiles larger; `alert` one strip line per metric, first 3 plus plain "+N". Value via `Intl.NumberFormat` or string with 2-line clamp, "–" if missing; state icon plus text label with `aria-label`; trend arrow/delta coloured by `good` versus direction; optional tile `CardLink`; 200 ms value cross-fade via a previous-value hook, off under reduced motion; `searchText` over label, value, unit, state word.
Done when: tests cover 1/3/6 items, flat-form fixture equal to `items` form, `delta:-3, good:"down"` positive, icon plus text, "Deployed" string value, fade toggling with reduced motion, alert layout.

## Task 9 — media type
What it is / what it means: safe image figures (V10).
What changes at a high level: `<figure>`/`<figcaption>`, `grid` (2 columns, 16:9 cover, 1 column when narrow) and `single` (contain); `loading=lazy`, `decoding=async`, `referrerpolicy=no-referrer`, fixed aspect box; `safeImageSrc` failure or load error shows placeholder with alt/caption while the `link` still works; compact 6 plus "+N more", fullscreen all; no zoom or video; `allowedModes` excludes `alert`; `searchText` = alt + caption.
Done when: tests assert no `<img>` for disallowed srcs, required attributes present, broken image keeps alt text and working link, layouts, cap and "+N more".

## Task 10 — Registration hub, fixtures, a11y, registry test
What it is / what it means: the one place a type is added (D7, "Add a type") and the acceptance sweep.
What changes at a high level: `ui/src/types/index.ts` imports all five folders so each registers once, each with `allowedModes` as specified. Fixture tests render every `templates/*.example.json` with zero console errors and jest-axe clean; `searchText` never throws on empty/extra-key data; "+N more" is a button opening `view=full` in table/list/kpi/media; query pre-filter works for table/list.
Done when: 03#5's registry-completeness test against 01's `listTypes()` is active (pending marker removed) and green for all five types; all PRD Acceptance Criteria bullets map to passing tests; `npm run lint && npm run typecheck && npm test` pass.

## Manual steps (owner)
None for 04.
