---
name: crontick-dashboard
description: Write cards to the local crontick-dashboard feed so they show on the user's dashboard. Use when asked to "show on my dashboard", "write a dashboard card", "raise an alert", "notify me", or to publish a table, list, KPI, markdown or media panel (e.g. unread email, today's tasks, service health) for the user to see.
allowed-tools: shell
---
<!-- crontick-dashboard@0.0.0 -->

# crontick-dashboard — write cards the dashboard shows

## 1. Purpose / when to use

crontick-dashboard is a local dashboard that renders **cards**: JSON files that agents drop into a feed directory. You write files; the dashboard watches the dir and shows them. No daemon call is needed to write.

**Never guess the feed path.** Run `crontick-dashboard info --json` and use its `feedDir`:

```sh
crontick-dashboard info --json   # -> { "feedDir": "...", "url": ..., "skillPath": ..., ... }
```

## 2. Card envelope

One file per card: `<feedDir>/<id>.json`.

| field | notes |
|---|---|
| `id` | lowercase slug `[a-z0-9._-]`, max 64, **must equal the filename stem**, no Windows-reserved names (con, nul, ...) |
| `kind` | `panel` (lives in the grid) or `alert` (persists until ticked) |
| `type` | `markdown`, `table`, `list`, `kpi`, `media` |
| `title` | 1-200 chars |
| `updatedAt` | ISO timestamp; bump on every rewrite (resets Done) |
| `priority` | 0-5, default 2 |
| `size` | `S`/`M`/`L` |
| `show`, `staleAfter`, `retention`, `notify` | see sections 6-7 |
| `error` | reason string when you failed (section 8) |
| `data` | type-specific body |

Schema: `crontick-dashboard templates <type> --schema`. Minimal card:

```json
{ "id": "daily-briefing", "kind": "panel", "type": "markdown", "title": "Daily briefing",
  "updatedAt": "2026-10-05T07:30:00Z", "data": { "text": "## Today\n- Standup at 10:00" } }
```

## 3. Types

Get a valid, runnable example with `crontick-dashboard templates <type>` (list all with `crontick-dashboard templates`). Start from it; **change its `id` to your own** (and make the filename match). Do not copy schemas from memory.

- `markdown`: prose/briefings (`data.text`).
- `table`: rows of cells (email, issues, search results).
- `list`: items/tasks; optional checkbox via `action`.
- `kpi`: several metrics per card in `data.items` (label, value, state, trend).
- `media`: images/screenshots in a grid.

Links: `link` on a table row, list item, kpi item or media item makes it clickable. Allowed schemes only: http|https|mailto|ms-outlook.
`action` on a list item is `dismiss` (local tick) or `complete` (write-back, see section 4); items with an action need an `id`.

## 4. Workflow

1. **If `<feedDir>/<id>.json` already exists, read the existing card first** and act on every list item with `checked: true` (e.g. complete the matching task in TickTick with your own access, using the item's private extras such as `ticktick: {taskId, projectId}`). The dashboard only sets `checked`/`checkedAt` on ticked items and keeps your extras.
2. Build the new card JSON (drop or re-mark handled items; bump `updatedAt`).
3. **Validate before writing**: pipe the JSON to `crontick-dashboard validate -` (exit 0 = OK, 1 = Broken; fix and retry). Stdin validation does not check the filename rule, so make sure `id` equals the filename stem yourself. (`crontick-dashboard validate <file>` also checks the name, but only if the file is already named `<id>.json`; use it on a file outside the feed dir.)
4. **Write atomically**: write `<feedDir>/<id>.json.tmp`, then rename to `<feedDir>/<id>.json`. The watcher ignores `*.tmp`, so readers never see a half-written card.
5. Rewrite the same id to update. Never delete other agents' files.

## 5. Id rules

`id` = lowercase slug, `[a-z0-9][a-z0-9._-]{0,63}`, not ending in `.`, equal to the filename stem. Mismatch makes the card Broken (`id-mismatch`).

## 6. Alert vs panel

- `panel`: sits in the grid; any type.
- `alert`: unmissable, persists until the user ticks it; only `markdown`, `list`, `kpi`.
- `priority`: at or above the Now threshold the card surfaces during its `show` window; 1 or lower collapses.

## 7. Timing fields

- `show: { cron: "<5-field cron>", for: "<duration>" }`: visible window. **`for` omitted = the window lasts until the end of that local day. A card with no `show` is always visible.** Alerts honor `show` too: an alert with `show` appears only inside its window.
- `staleAfter` (e.g. `26h`): set it for recurring jobs. Past it the card is Broken, never shown as old data.
- `retention`: how long to keep it after it stops being current.
- `notify: true`: only for things that must interrupt the user.
- Durations are single-unit: `30m`, `2h`, `26h`, never `1h30m`.

## 8. Failure

If your job failed, write `error: "<reason>"` instead of stale data (`data` may then be omitted). Still bump `updatedAt`.

## 9. Extending without a new schema

Types are generic: add columns, fields, keys freely; extras are preserved. Example, an email table with two links per row (row `link` = open the email, cell link = unsubscribe, both clickable):

```json
{ "id": "unread-email", "kind": "panel", "type": "table", "title": "Unread email",
  "updatedAt": "2026-10-05T07:45:00Z", "staleAfter": "2h",
  "data": {
    "columns": ["From", "Subject", "Unsubscribe"],
    "rows": [
      { "cells": ["Dana", "Invoice", { "text": "Unsubscribe", "link": "https://example.com/unsub" }],
        "link": "https://outlook.office.com/mail/deeplink/read/ID" }
    ] } }
```

Cells are string, number, boolean, null or `{text, link?}`. List items can carry `links: [{text, link}]` for secondary links. kpi cards list several metrics in `data.items`.

## 10. Task lists (TickTick etc.)

`list` items with `action: {"type": "complete"}` get a checkbox; ticking writes `checked: true` and `checkedAt` into the card file. You decide what appears: list only the important or due tasks (the dashboard never queries TickTick). Give each item an `id`, an optional `due` (ISO date or datetime, shown relative/overdue), and put identifiers in an extra field, e.g. `ticktick: {taskId, projectId}`. Next run, follow section 4: read the card, complete ticked tasks, rewrite.

## 11. Gotchas

- Extras are allowed and preserved untouched; `x-` keys are yours.
- No input widgets in the UI; cards never trigger jobs.
- Durations are single-unit (`26h`).
- Never guess the feed dir; always `crontick-dashboard info --json`.
- After upgrading the package, re-run `crontick-dashboard skill install --force` to refresh this file (the owner does this).
