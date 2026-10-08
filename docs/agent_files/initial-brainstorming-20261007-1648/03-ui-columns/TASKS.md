---
status: draft
summary: SP03 UI columns — 9 tasks - tokens, API/state over new DTO, CardFrame and Chip, columns shell with grid removal, alert strip, header filter, Completed section, search and deep link, acceptance closure.
date: 2026-10-08
---
# Tasks: UI columns (SP03)
Source of truth: docs/agent_files/initial-brainstorming-20261007-1648/03-ui-columns/PRD.md. All PRD items are RESOLVED or DEFERRED; no open questions block these tasks. Tests ship with each task under `ui/tests/`. All tasks consume the SP02 snapshot DTO; SP01 supplies types only.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Layout tokens and breakpoint test | — | done |
| 2 | API client and optimistic state over new DTO | SP02 | done |
| 3 | CardFrame heights, no-data state, collapsed Chip, type mode cleanup | SP01, SP02 | done |
| 4 | Columns shell, Now zone, grid removal | 1, 2, 3 | done |
| 5 | One-line AlertStrip | 2, 4 | done |
| 6 | Header All/Alerts/Cards filter | 4, 5 | done |
| 7 | Completed section | 2, 4, 6 | done |
| 8 | Search scope and deep-link updates | 5, 6, 7 | done |
| 9 | Acceptance closure: poll stability, removals, 300px check | 4–8 | done |

## Task 1 — Layout tokens and breakpoint test
What it is / what it means: the derived token layer and the single breakpoint literal (Page layout table; Decisions 1, 2, 12).
What changes at a high level: add `--col-side`, `--col-gap`, `--page-pad`, `--h-S/M/L`, `--chip-h` to `tokens.css`, with a comment beside the token noting the 1200px media-query literal cannot use a var. Add a test constant for 1200px that the later `columns.css` literal is checked against (the check goes live in Task 4).
Done when: tokens present and asserted by a test; `npm run validate` green.

## Task 2 — API client and optimistic state over new DTO
What it is / what it means: remove layout persistence and re-base mutations on the new snapshot shape (API client / state section; Decision 10, 17).
What changes at a high level: delete `putLayout`, `putLayoutKeepalive`, the `layout` op, `LayoutItem` re-export and `LAYOUT_DEBOUNCE_MS`. Replace `applyZone` with `applyFlag` implementing the PRD mutation table (done, reopen, hide, unhide, alert tick; item check unchanged). Update `attentionCount` to alerts plus unseen `notify` in `now` and columns cards, ignoring filter. UI applies no DTO defaults. Update client types for `ViewCard` and `ViewAlert`.
Done when: tests cover each optimistic patch including no-gap cases and the refetch-only cases; `npm run validate` green (consumers adjusted minimally until Task 4).

## Task 3 — CardFrame heights, no-data state, collapsed Chip, type mode cleanup
What it is / what it means: the card frame per the Card frame table (Decisions 5, 7, 11, 12).
What changes at a high level: `CardFrame` applies fixed S/M/L heights or auto with max L, drops `height:100%` and `drag-handle`, and renames `Mode` to column/now/fullscreen. Add the muted dashed `no-data` frame ("No data yet", no type body, no Done/fullscreen, Hide kept). New `frame/Chip.tsx` collapsed chip button with dot, title, `▾`, aria label, expand-on-click, notify dot kept. Remove the in-slot Done chip. In `list`, `markdown`, `kpi` delete `alert` mode branches and rename `grid` to `column` in `allowedModes`.
Done when: tests cover heights, chip expand/collapse and keyboard activation, no-data, broken unchanged, and existing type tests stay green; `npm run validate` green.

## Task 4 — Columns shell, Now zone, grid removal
What it is / what it means: replace the drag/resize grid with CSS-grid columns (Page layout, Now zone, Removed; Decisions 8, 9).
What changes at a high level: new `zones/Columns.tsx` plus `columns.css` with the 300px/flexible/300px grid, areas left|center|right, DOM order center, left, right, stacked under 1200px with empty columns hidden when narrow. Center renders Now first when non-empty, stacked full width, without alerts. Column cards keyed by id in server order. Rewrite `App` page shell and empty-page states. Delete `Grid.tsx`, `grid.css`, `layout-writer`, `DoneTray`, `placement`, `constants/grid.ts`, related tests and `react-grid-layout` mocks; drop the dependency from `package.json` and the lockfile.
Done when: tests cover column order, DOM order, Now-first with card absent from its column, empty column, empty-page states and the breakpoint literal check; `npm run validate` green.

## Task 5 — One-line AlertStrip
What it is / what it means: rewrite the strip for `ViewAlert` (Alert strip section; Decisions 6, 11).
What changes at a high level: region with `aria-live`, a `<ul>` of one row per alert: priority dot, bold title, clamped text with tooltip, `CardLink`, tick button. Omit missing text/link and separators. Broken rows read "Broken alert file: <message>" with tick working. Remove typed-body and registry lookups from the strip.
Done when: tests cover rows with and without text and link, broken copy, tick calling the mutation and removing the row; `npm run validate` green.

## Task 6 — Header All/Alerts/Cards filter
What it is / what it means: the segmented filter (Header filter section; Decision 13).
What changes at a high level: radiogroup in `Header`, default All, persisted to `localStorage` with try/catch fallback. `App` renders strip and columns/Now according to the filter table. Hidden popover and `attentionCount` ignore the filter. Cards filter with no cards shows an empty-cards state, not the app-wide empty state.
Done when: tests cover default, each mode's visibility, persistence, throwing storage, and unfiltered popover and attention count; `npm run validate` green.

## Task 7 — Completed section
What it is / what it means: the collapsible full-width list of Done cards and ticked alerts (Completed section; Decisions 3, 4, 14, 16).
What changes at a high level: new `zones/Completed.tsx` plus css. Header button with `aria-expanded` and "Completed (n)", default open, state persisted with safe storage. Rows from `snap.completed` newest first at `--chip-h`: card rows with done age and Reopen (`DELETE /done`), alert rows with optional text, link and ticked age, no action. Hidden at n = 0; n counts after filter; page stays visible when only completed content exists.
Done when: tests cover hidden-at-zero, toggle persistence incl. throwing storage, row formats, Reopen call, and optimistic done/reopen/tick flows; `npm run validate` green.

## Task 8 — Search scope and deep-link updates
What it is / what it means: align search and `#card=` handling with columns and Completed (Search, Deep link sections; Decision 15).
What changes at a high level: search follows the filter and builds `visible` from alerts, now, center, left, right, completed in DOM order; alerts match title plus text; collapsed chips are outlined without expanding. Add `OtherMatch.where: 'completed'` for matches while the section is closed; selecting one opens it, scrolls and highlights. Deep link to a Done card switches filter to All, opens Completed, scrolls and highlights; hidden and unknown ids still toast.
Done when: tests cover chip outline, Enter cycle order, completed other-matches, done-card deep link and toasts; `npm run validate` green.

## Task 9 — Acceptance closure: poll stability, removals, 300px check
What it is / what it means: close acceptance items not covered per task.
What changes at a high level: add the poll test (changed `data` leaves DOM order and element identity intact); the removal grep over `ui/src`, `ui/tests`, `package.json` plus lockfile check; a render check of kpi tiles and media at 300px; confirm Glance behaviors (visited link color, relative time, clamp, `+N more`, search shortcuts) remain covered. Fix any gaps found.
Done when: all acceptance bullets map to passing tests or the grep is empty; `npm run validate` green.

## Closing note
Human-only manual checks (PRD Manual acceptance): run `crontick-dashboard start` with sample cards in left, center and right; tick an alert and Done a card and confirm both appear in Completed and Reopen works; confirm filter and Completed toggle persist across reload; resize the window across 1200px; confirm a table template in the left column is readable. The deferred horizontal-scroll hint for tables is decided only after this visual check. `docs/implementation/ui.md` belongs to SP04.
