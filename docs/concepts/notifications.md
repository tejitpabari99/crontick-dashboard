# Notifications

Audience: users wondering when they get a toast, and contributors touching the notifier.
Non-duplication: the card fields (`notify`, `priority`) are defined in `docs/reference/`; the config key and platform setup steps are in `docs/reference/` and the README; the library choice and its open risk are in [ADR 0004](../decisions/0004-os-notifications-via-node-notifier.md).

## Goal

A watcher card ("deployment finished") must not be missed, even with the browser closed. So the server, not the page, raises a native OS notification, and the page also highlights the card.

## When a notification fires

A card produces a notification when it has `notify: true` and it is new or has a changed `updatedAt`, is not Broken, and is currently visible (inside its `show` window). Each `updatedAt` notifies once; the dedupe marker is kept in state, so a restart does not repeat old notifications.

Rewriting a card to the same content does not notify, and neither does the server's own write-back.

## What it says

One plain-text line, capped in length, derived from the card by its type (first line of a markdown note, first list item plus a count, first metric, a row count, a caption). It never dumps card data. Each type supplies its own summary through the contract registry, so the notifier has no per-type branches. Where the platform supports click-through, clicking opens the dashboard on that card (`#card=<id>`).

## Bursts

If many cards change at once the notifier collapses them into a single summary toast after a small limit, but still names high-priority alerts so they are never hidden by the collapse.

## Where it works

Delivery is behind an adapter interface, so tests use a fake and the library can be swapped. Whether OS notifications run is decided once by a gate using the `notifications.os` setting (`auto`, `on`, `off`):

- macOS and Windows: on in `auto`.
- Linux: on in `auto` only with a display and `notify-send` available.
- Headless hosts (a VPS): in-page highlight only, with the reason reported by `info`.

Delivery failures are isolated: they raise a warning and never break ingestion. Notifications can be missed while the server is not running, which is accepted for v1 (see [server-lifecycle](server-lifecycle.md)).

## Status

Linux behavior is verified. Real-machine Windows and macOS runs (toast, click-through, permission prompts, Focus Assist) are still owner-pending; see [ADR 0004](../decisions/0004-os-notifications-via-node-notifier.md).
