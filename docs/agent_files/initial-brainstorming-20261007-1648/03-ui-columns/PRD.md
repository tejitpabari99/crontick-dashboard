---
status: draft
summary: UI redraw around three fixed columns with declared heights, Now at top of center, collapsed chip in slot, one-line alert rows, a collapsible Completed section (Done cards + ticked alerts) and an All/Alerts/Cards header filter; react-grid-layout, drag/resize and Done tray removed.
date: 2026-10-08
---
# PRD: UI columns (SP03)
Repo/branch: crontick-dashboard / `initial-brainstorming` · Depends on: SP01 (types only), SP02 (snapshot DTO) · Owns: `ui/**` (`src/App.tsx`, `src/zones/`, `src/frame/`, `src/api/`, `src/lib/placement.ts` + `src/constants/grid.ts` + `zones/layout-writer.ts` (delete), `src/theme/tokens.css`, `ui/tests/**`), `package.json` + lockfile (drop `react-grid-layout` only), `docs/implementation/ui.md` is SP04's

## TL;DR
`Grid` (react-grid-layout), `layout-writer`, `placement`, `DoneTray` and the layout mutation go away. `App` draws: header (with All/Alerts/Cards filter), full-width alert strip of one-line rows, then three CSS-grid columns (left 300px, center flexible, right 300px; stack center, left, right under 1200px). Center starts with Now. `CardFrame` gets fixed heights S/M/L/auto and one engine-applied chip: the **collapsed chip** (low priority; click = expand), in the card's own slot. Done cards and ticked alerts leave the page and are listed in a full-width, collapsible **Completed** section below the columns (Done card row has Reopen). The old in-slot Done chip is removed. Visual types are untouched except the dead `alert` mode.

## Problem
v0.1.0 draws a 12-col drag/resize grid with a bottom Done tray, packs positions client-side (`placeCards`) and persists them (`PUT /api/layout`). The snapshot now carries `columns`, `now`, `alerts`, `hidden`, `completed`, `completedAlertItems`, and `ViewCard.{column,height,status,collapsed,done,doneAt}`; `zones`, `layout`, `size`, `kind` are gone (SP02).
Evidence: `ui/src/zones/Grid.tsx`, `ui/src/App.tsx` (`snap.zones.*`, `snap.layout`), `ui/src/api/mutations.ts` (`putLayout*`, `applyZone`), `ui/src/frame/CardFrame.tsx` (`drag-handle`, `isChip` only in `mode==='grid'`).

## Goals / Non-Goals
Goals: columns drawn from snapshot ids, no client placement; declared heights; collapsed chip in slot; line alerts; Completed section and filter; no layout shift on poll; search and Glance look intact.
Non-goals: server/DTO work (SP02), type internals (SP01/04 untouched), CLI/docs (SP04), `span`, configurable widths, mobile polish, optimistic placement of unhidden cards, un-tick for alerts (futures).

## Requirements

### Page layout
| Piece | Spec |
|---|---|
| Tokens (`tokens.css`, derived layer) | `--col-side: 300px`, `--col-gap: 16px`, `--page-pad: 16px`, `--h-S: 180px`, `--h-M: 360px`, `--h-L: 600px`, `--chip-h: 32px`. Breakpoint literal `1200px` (CSS cannot use vars in `@media`): one comment beside the token, one constant in `ui/tests` asserting both agree |
| Shell | `<main class="page">`: alert strip, then `.columns` = CSS grid `grid-template-columns: var(--col-side) minmax(0,1fr) var(--col-side)`, areas `left center right`, `align-items:start`, gap `--col-gap` |
| Narrow (<1200px) | One column, order **center, left, right**. DOM order is center, left, right so keyboard tab order matches the narrow on-screen order (WCAG 2.4.3); wide layout places `left | center | right` with `grid-template-areas`. Wide tab order therefore runs center, left, right (accepted; Decision 9) |
| Empty column | Renders its (empty) element, keeps the width: no shift when the first card arrives. Narrow: empty column `display:none` |
| Empty page | All of `columns.*`, `now`, `alerts`, `hidden`, `completed` empty → existing "No cards yet" state; hidden-only keeps the page with the header popover; completed-only keeps the page with the Completed section |
| Center | `<NowZone>` first (only if `now` non-empty), then `columns.center` cards |

### Alert strip (`AlertStrip`, rewritten for `ViewAlert`)
Full width, `role=region aria-live=polite aria-label=Alerts`, a `<ul>` of **one-line rows**, one alert per row (not wrapping side by side): `[priority dot] title · text? · link ↗ · [✓ Tick]`. `text` and `link` are optional: missing parts and their separators are omitted. Title bold, no-shrink up to 30%; text `clamp-1` with `title` tooltip (full text); link via `CardLink`; tick button right, always visible. Broken alert (`status:'broken'`): negative tint, copy `Broken alert file: <message>` (title kept if parsed, else id), tick still works. Hidden when filter = Cards. Alerts cannot be hidden, collapsed or opened fullscreen. `mode:'alert'` bodies and `registry` lookups removed from the strip. Search dims/outlines rows by `title + text?`.

### Card frame
| State | Rendering |
|---|---|
| ok | Frame as today; height by `card.height`: `S/M/L` → fixed `height: var(--h-*)`; `auto` → `height:auto; max-height: var(--h-L)`. Body keeps `overflow:auto` (scrolls inside), `.card-frame` drops `height:100%` |
| Now card | Same frame, height rule from its `height`, in the Now zone (column slot is vacated, see below) |
| broken | Unchanged (negative tint, reason, message); keeps declared height. Done/Hide still available |
| `no-data` | New: muted frame (`--text-muted`, dashed border), title bar normal, body = "No data yet" (`.meta`), no updatedAt meta, no type body mounted. Done/fullscreen hidden (nothing to act on), Hide kept. Height rule applies (so the slot is reserved as declared) |
| Collapsed chip (`collapsed && !expanded`) | `<button class="chip chip--collapsed">`: priority-low dot (muted) · title · `▾`. Click = expand (UI-local `expanded` set, as today); expanded card shows `▴` Collapse in the bar, as today |
| Fullscreen | Unchanged (`<dialog>`, `mode:'fullscreen'`, `#card=<id>&view=full`) |

Done cards never reach the frame: they are in `completed`, not in `columns`/`now`. Collapsed chip = `--surface-1` with a solid border, leading dot, trailing `▾` chevron; `aria-expanded=false` + `aria-label="Expand <title>"`. It keeps the notify dot (a low-priority `notify` card still got new content). The in-slot Done chip (and Done-vs-collapsed precedence) is removed; a reopened low-priority card returns in its slot as a collapsed chip.
`CardFrame` loses the `mode==='grid'` coupling: `Mode` = `column | now | fullscreen` (`grid`→`column`; `alert` removed, see Types). `drag-handle` class dropped.

### Now zone
Rendered at top of center only if `snap.now` non-empty. Cards stacked full center width (no wrapping flex row, no min-width 320). A card in `now` is **not** in `columns.*` (SP02), so its slot is vacated while pinned (a Done card is in neither) and the column reflows once on window entry/exit; accepted (rare, schedule-driven, never on a plain poll). No placeholder stub left behind. Alerts no longer live inside `NowZone`.

### Hidden recovery (verified today: `Header` → `HiddenPopover`, plus search dropdown rows)
Kept unchanged: header `Hidden (n)` popover with Unhide, and search "Other matches" for hidden cards. Hidden cards appear only in the popover and dropdown. Both are unaffected by the filter. No UI to hide alerts.

### Header filter
Segmented control (`role=radiogroup`, three buttons) in the header: **All / Alerts / Cards**, default All, persisted in `localStorage` (try/catch; works without it).
| Filter | Shown |
|---|---|
| All | alert strip, Now, columns, Completed (cards + alerts) |
| Alerts | alert strip + completed alerts only (columns and Now not rendered) |
| Cards | Now + columns + completed cards only (alert strip not rendered) |
Search scope follows the filter. Hidden popover and `attentionCount` ignore the filter. A Cards-filter page with no cards but alerts present still shows the empty-cards state, not "No cards yet" for the whole app.

### Completed section (`CompletedSection`)
Full width below the columns (narrow: after all columns). Hidden entirely when its filtered list is empty (n = 0). Header = `<button aria-expanded>` "Completed (n)" + chevron; default open; open/closed persisted per browser in `localStorage` (try/catch; works without it). Rows come from `snap.completed` (newest first), one line each:
- card (`completed.kind==='card'`, `cards[id]` with `done:true`): `✓ title · done <relative age from doneAt> · [Reopen]`; Reopen = `DELETE /api/cards/:id/done`.
- alert (`completedAlertItems[id]`): `✓ title · text? · link ↗ · ticked <relative age from tickedAt>`; no action (un-tick is futures).
Rows are plain, fixed `--chip-h` height; title ellipsis. n counts rows after the filter. Server lists ticked alerts for 7 days, max 50 (SP02); the UI does not cap further.

### Search
Scope follows the filter: every card in `columns.* ∪ now` (inline, dim/outline, no reflow; a matching collapsed chip gets the outline and is not auto-expanded), alerts by `title + text?`, Completed rows (inline while the section is open), plus `hidden` and collapsed-Completed matches via the dropdown "Other matches" (`OtherMatch.where: 'hidden' | 'completed'`). Selecting a `completed` match opens the section (persisting it), scrolls to the row and highlights it. Total = visible + other matches. Enter cycles in DOM order: alerts, now, center, left, right, completed. `visible` is built from `[alerts, now, center, left, right, completed]`.

### Deep link
`#card=<id>` unchanged except: a collapsed chip is an in-slot element, so scroll + highlight just works. A Done card: switch the filter to All if needed, open Completed, scroll to its row and highlight it (no toast). Hidden still toasts. Unknown id still toasts "card not found". Alert ids are not deep-linkable (alerts open `/`, SP02).

### API client / state
Delete `putLayout`, `putLayoutKeepalive`, `layout` op, `LayoutItem` re-export, `LAYOUT_DEBOUNCE_MS`. Optimistic `applyZone` becomes `applyFlag` over the new DTO:
| Mutation | Optimistic patch | Gap until refetch |
|---|---|---|
| done | remove id from `columns.*`/`now`, prepend `{kind:'card',id}` to `completed`, set `cards[id].done=true` | none |
| reopen (`DELETE /done`) | remove from `completed`, set `done=false` | card reappears in its slot on refetch (<1 poll round trip) |
| hide | remove id from `columns.*`/`now`, add to `hidden` | none |
| unhide | remove from `hidden` only | card appears on refetch (<1 poll round trip) |
| alert tick | remove from `alerts` (appears in Completed on refetch) | none |
| item check | unchanged | |
`ViewCard.kind` and `ViewAlert` map: `getChecked`/`onItemAction` unchanged for cards only. `attentionCount` = `alerts.length` + unseen `notify` among `now ∪ columns` cards (not no-data; Done cards are in neither). Unaffected by the filter.

### Visual types in a 300px column (verified by reading, to confirm by render test)
| Type | At ~270px content width |
|---|---|
| table | `.tbl--compact` is `table-layout:fixed` + `.tbl-wrap{overflow-x:auto}`: with many columns cells shrink to ellipsis, toolbar wraps (`flex-wrap`). Acceptable ≤3 columns; wider tables scroll horizontally. No change; guidance "wide tables go center" (SP04 skill/docs) |
| list, markdown, kpi, media | Fluid; no fixed widths found. Check kpi tile grid and media aspect once at 300px |
| compact caps / `+N more` | Caps are row-count based, independent of width; `ShowMore` → fullscreen still works |
Type changes: only remove the `alert` mode branches (`list`, `markdown`, `kpi`) and `'alert'` from `Mode`/`allowedModes`, since alerts no longer render typed bodies. `grid`→`column` rename in `allowedModes`. Nothing else.

### Removed
`react-grid-layout` (package.json, lockfile, `import 'react-grid-layout/css/styles.css'`), `zones/Grid.tsx`, `grid.css`, `layout-writer.ts`, `DoneTray.tsx` + `.done-tray*` CSS, the in-slot Done chip (never shipped), `constants/grid.ts`, `lib/placement.ts`, `size`/`LayoutItem` usage, `.drag-handle`, `ui/tests/{grid,placement}.test.tsx|ts`, and every `vi.mock('react-grid-layout')` in `server-down`, `header`, `fullscreen`, `now-zone` tests.

### No layout shift on poll
Columns render ids in server order with stable `key=id`; no client reordering, no animation of position. S/M/L are fixed so content changes never resize a card; only `auto` can grow (to L max). Frame elements for the collapsed chip/`no-data`/Completed rows have fixed `--chip-h` / the declared height. `card-frame--enter` fade-in kept (opacity/scale only, no layout).

## Architecture
```
Snapshot{columns,now,alerts,hidden,completed,cards,alertItems,completedAlertItems}
  App: filter (All|Alerts|Cards, localStorage); pick(ids) -> ViewCard[] per column
   ├ Header (filter control, search, Hidden popover)
   ├ AlertStrip(alerts: ViewAlert[])           role=region, line rows  [filter != Cards]
   ├ Columns                                   [filter != Alerts]
   │   ├ Column(center) -> NowZone? + ColumnCards      (DOM order: center, left, right)
   │   ├ Column(left)   -> ColumnCards
   │   └ Column(right)  -> ColumnCards
   └ CompletedSection(completed, cards, completedAlertItems, filter)
ColumnCards: card.collapsed && !expanded ? <Chip/> : <CardFrame mode=column/>
```
New files: `zones/Columns.tsx` (+`columns.css`), `zones/Completed.tsx` (+css), `frame/Chip.tsx` (+css; collapsed chip only), filter control in `Header`. `CardFrame` keeps the full-frame render and the notify/seen/enter logic; chip branch moves to `Chip`. Fullscreen button/Done/Hide stay in the frame bar.

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| 1 | Side width | 300px token `--col-side` | 280/320; % | Brief ~300px; 320 leaves center 560px at 1200 |
| 2 | Breakpoint | 1200px (Glance's ~1190) | 1024 | center ≥ 568px at breakpoint (1200-600-2*16-2*16) |
| 3 | Done cards | Leave their slot, listed in Completed with Reopen button | In-slot Done chip (earlier pick, reversed by owner 2026-10-08); bottom tray | Owner wants ticked things listed, not hidden; Completed can be collapsed |
| 4 | Completed content | Done cards + ticked alerts, newest first, one line each | Cards only | Owner choice 2026-10-08 |
| 5 | Collapsed chip | Stays in slot (low priority only); no Done precedence rules | Move to Completed | Unrelated to completion; keeps spatial memory |
| 6 | Alert rows | One alert per line; `text`, `link` optional | Side-by-side wrap (today) | Brief: "line" rendering; predictable height; SP01 allows no `text` |
| 7 | `no-data` | Muted frame, no actions but Hide | Chip-sized | Declared height keeps slot reserved; owner sees layout early |
| 8 | Now pinned slot | Vacated, no stub | Placeholder | Brief/SP02: Now card removed from column |
| 9 | Narrow order | DOM order center, left, right; CSS areas place wide `left\|center\|right` (reverses earlier "DOM left-center-right") | CSS `order` for narrow | Keyboard order must match on-screen order (WCAG 2.4.3) on narrow; wide tab order accepted |
| 10 | Unhide optimistic | Remove from hidden only | Insert by order client-side | Needs column/order logic the UI must not own |
| 11 | Type `alert` mode | Remove | Keep unused | Dead code; only touch is deleting branches |
| 12 | Heights | CSS tokens, fixed | JS-measured | No layout thrash; matches brief 180/360/600 |
| 13 | Header filter | All / Alerts / Cards segmented control, default All, remembered in localStorage | No filter; tabs | Owner request; Hidden popover and attention count stay unfiltered so nothing is silently lost |
| 14 | Completed open state | Default open, remembered in localStorage, hidden at n = 0 | Default closed | Owner: ticked items visible by default, closable |
| 15 | Search vs Completed | Inline when open; dropdown "Other matches" (`completed`) when closed, select opens section | Never search Completed | Same pattern as hidden cards |
| 16 | Alerts in Completed | No action, no un-tick | Un-tick button | v1 scope; futures |
| 17 | DTO defaults | UI applies none: server always sends `column`, `height`, boolean `done`/`collapsed` | UI defaults | SP02 contract (owner 2026-10-08) |

## Risks / Open Questions
- [RESOLVED: owner 2026-10-08 — server always sets `column` and `height`; `done`/`collapsed` always booleans; no-data cards have no `updatedAt`/`data`; a Done card is never in Now; UI applies no defaults] SP02 DTO questions.
- [RESOLVED: owner 2026-10-08 — DOM order center, left, right; CSS grid areas place wide layout left|center|right] Narrow-mode tab order.
- [DEFERRED] Forced-horizontal-scroll hint for a 300px table in a side column, until seen rendered.
- [RESOLVED: owner 2026-10-08 — "Broken alert file: <message>"] Broken alert row copy.
- [DEFERRED] `span`, configurable column widths, per-card chip override, drag (futures.md).
- [RESOLVED: verified] Hidden recovery lives in `Header`/`HiddenPopover` and search dropdown, not in the grid or tray.
- [RESOLVED: verified] Nothing outside `ui/src/zones/Grid.tsx` imports react-grid-layout (grep: tests mock it only).
- Risk: a column with only chips shrinks to chip height stacks; fine, intentional.

## Acceptance Criteria
- `npm run validate` green; `grep -ri "react-grid-layout\|putLayout\|LayoutItem\|DoneTray\|chip--done\|zones\.\(grid\|tray\)\|\.size\b" ui/src ui/tests package.json` empty; lockfile no longer lists the package.
- jsdom tests: three columns in snapshot order (`order` then id preserved, no client sort); DOM order is center, left, right; Now is first child of center and its card is absent from its column; empty column renders; S/M/L/auto set expected height/max-height classes; collapsed chip click expands, `▴` collapses; chip is a `<button>` with correct label, Enter/Space activate; `no-data` shows "No data yet" and mounts no type body; Broken unchanged; alert rows are one-line with tick and link, render without `text` and without `link`, broken row reads "Broken alert file: <message>"; hidden popover and search "other matches" unhide.
- Completed tests: hidden at n = 0; header "Completed (n)" with `aria-expanded`, default open, toggle persists and survives a throwing `localStorage`; rows newest first; card row shows `✓ title · done <age> · Reopen` and Reopen calls `DELETE /done`; alert row shows title, optional text, link, "ticked <age>", no action; done optimistic update moves card from column/Now to top of Completed, reopen removes it, alert tick removes from strip.
- Filter tests: default All; Alerts hides columns/Now, keeps strip + completed alerts; Cards hides strip, keeps columns/Now + completed cards; persisted and works with throwing `localStorage`; Hidden popover and attention count unchanged by filter; search scope follows filter.
- Search/deep-link tests: search outlines matching collapsed chip and open Completed rows, cycles in DOM order; collapsed Completed matches appear as `where:'completed'` and selecting opens and scrolls to the row; `#card=<done id>` switches filter to All, opens Completed, scrolls and highlights; hidden/unknown still toast.
- Tokens/breakpoint test: `--col-side`, `--col-gap`, `--h-*` present, `1200px` literal in `columns.css` equals the test constant.
- Poll test: re-render with a changed `data` on an unchanged column leaves DOM order and element identity (`key`) intact.
- Type tests (`ui/tests/types/*`) green after `alert`/`grid` mode rename; Glance bits (visited link color, relative time, `clamp`, `+N more`, search shortcuts) still covered by existing tests.
- Manual: `crontick-dashboard start` with sample folders in left/center/right; tick an alert and Done a card (both appear in Completed, Reopen works, filter and toggle persist across reload); resize window across 1200px; table template in left column is readable.
