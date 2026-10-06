# Zones and layout

Audience: users and contributors who need to know where a card appears and why.
Non-duplication: the card fields that drive placement (`kind`, `priority`, `show`, `size`) are defined in `docs/reference/` (card schema); Done, hide, and tick behavior is in [actions-and-state](actions-and-state.md); the pure computation is covered in `docs/implementation/`.

## Calm over complete

The dashboard exists to surface the right thing without crowding. Placement is therefore computed by the server (a pure function of cards, state, config, and the clock) and delivered as ordered lists of card ids per zone. The UI draws; it does not decide.

## The zones

1. **Header.** Date, alert count, global search across all cards.
2. **Alert strip.** `alert` cards, unmissable, side by side and wrapping. Sorted by priority (high first), then newest. Persist until ticked.
3. **Now zone.** Panels that have a `show` window currently active and a priority at or above the configured threshold. They are pinned here during the window and return to their grid slot afterward. Only window-gated cards qualify: a high-priority card with no `show` stays in the grid.
4. **Grid.** The remaining panels, in a drag-and-resize grid. Positions are stable: nothing reorders automatically, so spatial memory works.
5. **Done tray.** Panels the owner marked Done appear as small heading-only chips at the bottom. Clicking reopens.

Hidden cards (hidden by the owner) are outside all zones but recoverable.

## Anti-crowding rules

- A per-card `size` hint (S, M, L); compact by default, with fullscreen for detail.
- Low-priority panels collapse to a title chip until clicked.
- Long lists and tables show a compact subset with a "+N more" affordance (fullscreen shows everything).
- No hard card cap: a cap would drop information; crowding is handled by collapsing, not deleting.

## Visibility

A `show` window hides a card outside its time (for example, office-hours notes only on Wednesday). The window is evaluated in the configured timezone. Alerts honor `show` too.

## Layout

New cards are placed in the first free grid slot with zero agent configuration. The owner can drag and resize; the layout is saved in `state.json` and survives restarts. Default arrangement follows a narrow, wide, narrow column rhythm borrowed from Glance.

## Polling and server-down

The UI polls the snapshot at a modest interval (bounded by config), slows down when the tab is hidden, and uses a revision tag so unchanged data is cheap. If the server cannot be reached the UI shows only a clear "server down" state, never cards from a previous poll, in line with the rule that stale data is never shown as current.

## Look

Calm, one accent colour, light and dark themes driven by a small set of HSL theme tokens, system fonts, subtle motion on data change. The visual direction borrows from Glance; see [ADR 0001](../decisions/0001-custom-build-and-runtime-model.md) and `docs/agent_files/initial-brainstorming/glance-borrow.md`.
