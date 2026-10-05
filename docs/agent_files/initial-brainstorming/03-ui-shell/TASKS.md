---
status: in-progress
summary: 12 commit-sized tasks building the React/Vite UI shell, from ui scaffold and theme through store, frame, zones, search, fullscreen/deep links, a11y and a Playwright smoke.
date: 2026-10-05
---
# Tasks: UI shell (03)
Source of truth: [PRD.md](PRD.md). The shell renders 02's snapshot and exposes the client type registry that 04 plugs into. Repo scaffold comes from 01#1 (06 completes it); the `ui/` Vite+React+TS scaffold is created here. "02 done" = snapshot API, mutations and shared `api-types` exist; until then tasks 2-3 develop against typed fixtures/mocks using 02#5's DTOs.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | UI scaffold and theme tokens | 01#1 | done |
| 2 | API client and snapshot store | 1, 02#5 | done |
| 3 | Optimistic mutations | 2, 02#8, 02#9 | done |
| 4 | Pure libs: placement, search, seen, relative time | 1, 02#5 | done |
| 5 | Client type registry, CardLink, error boundary | 1, 01 done | done |
| 6 | Card frame and Broken state | 3, 4, 5 | done |
| 7 | Grid zone and layout persistence | 3, 4, 6 | done |
| 8 | Now zone, alert strip, Done tray | 6, 7 | done |
| 9 | Header, search, Hidden popover, shortcuts | 4, 7, 8 | in-progress |
| 10 | Fullscreen and deep links | 6, 8 | todo |
| 11 | Server-down, empty state, a11y pass | 3, 9, 10 | todo |
| 12 | Browser smoke test and build handoff | 11, 02 done | todo |

## Task 1 — UI scaffold and theme tokens
What it is: the `ui/` Vite + React + TS app and the HSL-token theme (U1-U3, Theme section).
What changes at a high level: Vite root `ui`, `base './'`, default `ui/dist` outDir, `/api` dev proxy to the daemon port; `react`, `react-dom`, `react-grid-layout` (pick the latest major supporting React 19), no router/state lib; `ui` tsconfig and vitest project (jsdom, testing-library). `tokens.css`/`themes.css`/`base.css`: dark and light preset triples, calc-derived surfaces/text/ring, system-ui 13/12px type, flat cards. Pre-paint inline script plus `theme.ts` (system → light → dark toggle, localStorage in try/catch). `import type` only from 01/02.
Done when: `vite build` emits `ui/dist/index.html`; a test asserts both presets pass AA for text, muted, and primary-on-bg; theme toggle persists and sets `data-theme` without flash.

## Task 2 — API client and snapshot store
What it is: the data layer (U8): `client.ts` and a `useSyncExternalStore` store.
What changes at a high level: fetch with `If-None-Match` ETag, 304 = no re-render; structural sharing so unchanged cards skip re-render; poll interval from `snapshot.config.pollIntervalMs` clamped 15-60 s (30 s before first load); refetch on visibility regain; hidden-tab single 60 s slow tick; shared 150 ms-delayed spinner helper; re-exported types.
Done when: unit tests (fake timers, mocked fetch) cover ETag/304, clamping, pause/resume, structural sharing, and that a spinner appears only after 150 ms.

## Task 3 — Optimistic mutations
What it is: the mutation layer for done/undone, hide/unhide, tick, layout PUT and list-item actions.
What changes at a high level: local patch applied immediately, request with JSON content type and `X-Crontick-Dashboard: 1`, then refetch; rollback plus toast on error; 409 reverts, silently refetches and toasts "card updated, try again"; 500 reverts with the server error. `onItemAction` promise resolves on success and rejects with the server message; shell-tracked `pending` set; `checked` set union (item.checked, snapshot `checked`, optimistic).
Done when: tests with mocked 200/409/500 verify patch, rollback, toast text, headers, and the pending/checked sets.

## Task 4 — Pure libs: placement, search, seen, relative time
What it is: the tested pure logic (D21, D24, notify highlight, "updated ago").
What changes at a high level: `placement.ts` (first free slot scanning rows then x in snapshot order; S 3×4, M 3×7, L 6×9; missing size = M; never moves existing; retains entries of absent cards); `search.ts` (case-insensitive AND tokens over title + `searchText`, Broken = title + message); `seen.ts` (localStorage seen map, first visit = all unseen); relative-time formatter and the shared 60 s ticker (paused when hidden, refresh on visibility).
Done when: unit tests cover placement fill/no-move, size defaults, search semantics, seen read/write failures, time formats, and ticker pause/refresh.

## Task 5 — Client type registry, CardLink, error boundary
What it is: the interface provided to 04 plus the shared link and failure containment.
What changes at a high level: `registry.ts` with `CardTypeProps`, `CardTypeDef`, `registerCardType`, `ui/src/types/index.ts` import hub (empty until 04), unknown-type fallback body ("Unsupported type"), per-card error boundary ("Render error"). `CardLink` anchors only for `http|https|mailto|ms-outlook` (new-tab and `noopener noreferrer` rules; no `target` for ms-outlook; others plain text), trailing ↗, CSS-only `:visited` colouring, 2-line clamp with tooltip.
Done when: tests show unknown type renders the fallback, a throwing component is contained, `javascript:`/`data:`/`file:` never become anchors, and the CSS visited rules exist; a registry-completeness test against 01's `listTypes()` is in place (marked pending until 04 registers).

## Task 6 — Card frame and Broken state
What it is: the uniform frame for every panel, Now panel and fullscreen body.
What changes at a high level: title bar (truncated title, relative "updated" with absolute-time tooltip, priority marker at/above threshold, fullscreen/Done/hide actions on hover/focus), internally scrolling body, Broken body (reason, message, no data region ever, Hide and Done kept), notify highlight (ring and dot, cleared on click/focus or 1 s at 50% visibility), 600 ms updated fade and 120 ms mount-in (off under reduced motion), collapsed chip rendering (h=1, UI-local expand).
Done when: component tests cover Broken never showing data even if supplied, relative time ticking, notify highlight lifecycle, reduced motion, and collapsed expand/reload reset.

## Task 7 — Grid zone and layout persistence
What it is: the react-grid-layout zone (U4, U5).
What changes at a high level: 12 columns, one breakpoint, rowHeight 28, margin 10, title-bar drag handle, bottom-right resize; compaction on for rendering only; auto-place unplaced cards via `placement.ts`; persist full layout via debounced (800 ms) `PUT /api/layout` only on drag/resize stop or placement, flush on `pagehide` keepalive; ignore snapshot layout during an active drag; entries for absent cards retained.
Done when: tests show one PUT per burst, none from compaction-only changes, a Now card absent from the grid returns to its saved slot, and a priority ≤1 panel renders as a chip.

## Task 8 — Now zone, alert strip, Done tray
What it is: the Now zone (U7, U11) and Done tray.
What changes at a high level: Now zone rendered only if non-empty; alert strip (compact wrapping rows in snapshot order, `mode:'alert'`, Tick only, no hide or collapse, `role=region aria-live=polite`); promoted panels in a wrapping flex row (min 320px, `zones.now` order) using the frame; Done tray chips (title plus age) with click-to-reopen.
Done when: tests show alerts expose only Tick, panels in Now are absent from the grid, and tray chip click reopens via `DELETE /api/cards/:id/done`.

## Task 9 — Header, search, Hidden popover, shortcuts
What it is: the sticky header (D24, Hidden and Done recovery).
What changes at a high level: date, alert-count badge (scrolls to Now), `document.title` `(n) Crontick`, global search (dim non-matches to 30% with no reflow, accent outline, match count, Enter/Shift+Enter cycling, tray/hidden matches in a dropdown with open/unhide, `query` prop passed to types), `S` / `/` / Ctrl/Cmd+K focus and two-stage Esc, `Hidden (n)` popover with Unhide, theme toggle, connection dot, toast host.
Done when: tests cover search `dana` dimming with unchanged layout, `S` not stealing focus inside inputs, Esc behavior, hide → popover → unhide restoring slot, and the title count.

## Task 10 — Fullscreen and deep links
What it is: native `<dialog>` fullscreen (U10) and `#card=` handling for 05's toast click.
What changes at a high level: modal dialog (focus trap, Esc, focus restore) rendering the card at `mode:'fullscreen'` with search inherited; hash `#card=<id>&view=full` opens it; `#card=<id>` on load/`hashchange` scrolls the card into view (Now, alert strip, grid), applies a 2 s accent ring, then clears the hash; Done-tray or hidden target shows a toast.
Done when: tests cover open/close via hash, focus restore, the highlight timing, and the Done/hidden toast.

## Task 11 — Server-down, empty state, a11y pass
What it is: D19 failure behavior (U9) and accessibility basics.
What changes at a high level: after 2 failures, >2× interval since success, or failed first load, render only the "Server down" page (retry text, `crontick-dashboard daemon start` hint); store drops the snapshot, optimistic patches and pending layout writes; header reduced to theme toggle plus red dot; title "Server down"; backoff 5→10→30 s; auto-recover without reload. Empty-state hint with `crontick-dashboard info`. Landmarks, `aria-labelledby` sections, button labels, focus ring, jest-axe pass.
Done when: tests assert zero card elements and no cached titles/data in the DOM while down, recovery restores the full UI, and the axe check finds no critical violations on fixtures.

## Task 12 — Browser smoke test and build handoff
What it is: the one Playwright smoke (U12) and the build contract for 06.
What changes at a high level: `tests/smoke/**` boots 02's server (`startServer({uiDir})`) on a fixture feed from 01's examples and asserts: one card per type, a Broken card with message and no data, one alert, Done then reopen via tray, empty-state with zero cards, no console errors; confirm `ui/dist` is the output 06 copies to `dist/ui`.
Done when: the smoke passes locally against the built UI and `vite build` output is servable by 02.

## Manual steps (owner)
None for 03. (Playwright browser download is automated; the owner-only list in the README does not include UI items.)
