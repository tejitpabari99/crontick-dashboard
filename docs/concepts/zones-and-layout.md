# Zones and layout

Audience: users and contributors who need to know where a card appears and why.
Non-duplication: the card fields that drive placement (`layout`, `priority`, `show`) are defined in `docs/reference/` (card schema); Done, hide, and tick behavior is in [actions-and-state](actions-and-state.md); the pure computation is covered in `docs/implementation/`.

## Calm over complete

The dashboard exists to surface the right thing without crowding. Placement is therefore computed by the server (a pure function of cards, state, config, and the clock) and delivered as ordered lists of card ids. The UI draws; it does not decide.

## The page

1. **Header.** Date, alert count, global search across all cards, and the All / Alerts / Cards filter.
2. **Alert strip.** Full width, one line per alert: priority dot, title, optional text, optional link, and a Tick button. Sorted by priority (high first), then newest. Persists until ticked. Alerts cannot be hidden or collapsed.
3. **Three columns.** Left and right are fixed at 300px; the center is flexible. Each card declares its own column and order in `card.json`; within a column cards run by `order`, then id. Below 1200px the columns stack in one column in this order: center, left, right.
4. **Now zone.** Pinned at the top of the center column. Cards with a `show` window currently active and a priority at or above the configured threshold sit here during the window and return to their column slot afterward. Only window-gated cards qualify: a high-priority card with no `show` stays in its column.
5. **Completed section.** Full width below the columns (after all of them when stacked). See below.

Hidden cards (hidden by the owner) are outside all of this but recoverable from the header.

## Positions are declared, not dragged

There is no dragging or resizing. An agent (or the owner) sets `layout.column`, `layout.order` and `layout.height` in `card.json`, and the card appears there. Positions are stable: nothing reorders automatically, so spatial memory works. The only layout shift is a Now card entering or leaving its window.

## Heights

A card's `height` is `S`, `M`, `L` or `auto`. `S`, `M` and `L` are fixed heights and the body scrolls inside; `auto` grows with content up to the `L` height. A card with no data yet keeps its declared height, so the slot is reserved.

## Anti-crowding rules

- Fixed heights with scrolling bodies, plus fullscreen for detail.
- Low-priority cards (priority 0 or 1) render as a **collapsed chip** in their own slot: one line with a muted dot and the title. Clicking it expands the card. Collapsing is the way crowding is handled, not deleting.
- Long lists and tables show a compact subset with a "+N more" affordance (fullscreen shows everything).
- Alerts are **lines**, not boxes, so many alerts still cost little vertical space.
- No hard card cap: a cap would drop information.

## Completed section

Cards the owner marked Done and alerts the owner ticked leave the page proper and are listed in **Completed**, one line each, newest first.

- A Done card row shows its title, how long ago it was done, and **Reopen**, which returns the card to its slot.
- A ticked alert row shows title, text, link and how long ago it was ticked. There is no un-tick in v1.
- Ticked alerts are listed for 7 days and at most the newest 50; older files stay on disk. Done cards are not capped.
- The section is collapsible, remembered per browser, and hidden when empty.

## Header filter

The header's All / Alerts / Cards control chooses what the page shows. **All** shows everything. **Alerts** shows the alert strip and completed alerts only. **Cards** shows Now, the columns and completed cards only. The choice is remembered per browser. Search follows the filter: under Alerts it does not list hidden cards or card rows, and under Cards it does not search alerts. A `#card=<id>` link (used by notification clicks) to a Done card opens Completed at that row, and switches the filter to All only when it is Alerts (under Cards the Completed card rows are already visible).

## Visibility

A `show` window hides a card outside its time (for example, office-hours notes only on Wednesday). The window is evaluated in the configured timezone. Alerts honor `show` too.

## Polling and server-down

The UI polls the snapshot at a modest interval (bounded by config), slows down when the tab is hidden, and uses a revision tag so unchanged data is cheap. If the server cannot be reached the UI shows only a clear "server down" state, never cards from a previous poll, in line with the rule that stale data is never shown as current.

## Look

Calm, one accent colour, light and dark themes driven by a small set of HSL theme tokens, system fonts, subtle motion on data change. The visual direction borrows from Glance; see [ADR 0001](../decisions/0001-custom-build-and-runtime-model.md) and `docs/agent_files/initial-brainstorming/glance-borrow.md`.
