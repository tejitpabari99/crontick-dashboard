---
name: crontick-dashboard
description: Write cards to the local crontick-dashboard feed so they show on the user's dashboard. Use when asked to "show on my dashboard", "write a dashboard card", "raise an alert", "notify me", or to publish a table, list, KPI, markdown or media panel (e.g. unread email, today's tasks, service health) for the user to see.
allowed-tools: shell
---
<!-- crontick-dashboard@0.1.0 -->

# crontick-dashboard — write cards the dashboard shows

## 1. Purpose / when to use

crontick-dashboard is a local dashboard that renders **cards**: folders of JSON files that agents drop into a feed directory. You write files; the dashboard watches the dir and shows them. No daemon call is needed to write.

**Never guess the feed path.** Run `crontick-dashboard info --json` and use its `feedDir`:

```sh
crontick-dashboard info --json   # -> { "feedDir": "...", "url": ..., "skillPath": ..., ... }
```

## 2. Folder model

```
<feedDir>/<id>/card.json     # the view: type, title, layout, priority (you edit once)
<feedDir>/<id>/data.json     # the content (you rewrite every run)
<feedDir>/alerts/<id>.json   # one-line alerts (section 9)
```

- The card id is the folder name: lowercase slug `[a-z0-9][a-z0-9._-]{0,63}`, no leading `.`. `alerts` is reserved.
- `card.json` says how the card looks; `data.json` holds what it shows. A card without `data.json` shows "No data yet".
- `data` (in card.json) is a plain file name inside the card folder (default `data.json`): no subfolders, no symlinks leading outside.
- Ingest ignores dot-files and `*.tmp`.

| file | field | notes |
|---|---|---|
| card.json | `type` | `markdown`, `table`, `list`, `kpi`, `media` |
| card.json | `title` | shown in the card header |
| card.json | `layout` | `column`, `order`, `height` (section 6) |
| card.json | `priority`, `show`, `staleAfter`, `notify` | section 7 |
| data.json | `updatedAt` | ISO timestamp (section 5) |
| data.json | `data` | type-specific payload |
| data.json | `error` | reason string when you failed (section 8) |

Exact shapes: `crontick-dashboard templates <type>` prints a runnable card.json and data.json (`templates` alone lists all types). Do not copy schemas from memory.

## 3. First time: create the card

```sh
crontick-dashboard new <id> --type <type> --title "<title>" --column center --height M
crontick-dashboard templates <type> --file data    # the shape to write into data.json
```

`new` writes `card.json` only. Layout flags are optional: `--column left|center|right`, `--order <n>`, `--height S|M|L|auto`, `--priority 0-5`. It fails if the card exists (use `--force` to rewrite card.json only; data.json is never touched). Do this once; later runs only rewrite data.json.

## 4. Each run: write data.json

1. Build the new `data.json` content (shape from `crontick-dashboard templates <type> --file data`).
2. **Pre-validate** before writing: pipe it to `crontick-dashboard validate - --as data --type <type>` (exit 0 = OK; fix and retry).
3. **Write atomically**: write `<feedDir>/<id>/data.json.tmp`, then rename to `<feedDir>/<id>/data.json`. Ingest ignores `*.tmp`, so readers never see a half-written file.
4. **Check the result**: `crontick-dashboard validate <feedDir>/<id>` must exit 0 with no warnings.
5. Never delete other agents' files.

## 5. updatedAt

Set `updatedAt` (ISO timestamp) in data.json only when the content truly changed. If nothing changed, rewrite nothing: without `updatedAt` the file mtime is used, so a no-op rewrite looks like new data and re-notifies the user.

## 6. Layout

In card.json `layout`:

- `column`: `left`, `center` or `right` (narrow screens stack them). Put wide tables in `center`.
- `order`: integer; lower comes first within the column.
- `height`: `S`, `M`, `L` or `auto`.

## 7. priority, show, staleAfter, notify

Set once in card.json; edit it only to change behavior.

- `priority`: 0-5, default 2. At or above the Now threshold the card surfaces during its `show` window; 1 or lower collapses.
- `show: { cron: "<5-field cron>", for: "<duration>" }`: visible window. **`for` omitted = the window lasts until the end of that local day. A card with no `show` is always visible.** Alerts honor `show` too.
- `staleAfter` (e.g. `26h`): set it for recurring jobs. Past it the card is Broken, never shown as old data.
- `notify: true`: only for things that must interrupt the user.
- Durations are single-unit: `30m`, `2h`, `26h`, never `1h30m`.

## 8. Failure

If your job failed, write `error: "<reason>"` in data.json instead of stale data (`data` may then be omitted), and bump `updatedAt`.

## 9. Alerts

An alert is one file, `<feedDir>/alerts/<id>.json` (id = file name stem, same slug rules). Write it atomically like data.json (tmp, then rename); validate with `crontick-dashboard validate - --as alert`.

- `title`: required.
- `text`: optional, one line, at most 200 chars.
- `link`: optional, clickable. Allowed schemes only: http|https|mailto|ms-outlook.
- Also allowed: `priority`, `notify`, `show`, `updatedAt`.

A ticked alert moves to Completed in the UI. Alert with a title only:

<!-- example:alert backup-failed -->
```json
{
  "title": "Nightly backup failed",
  "link": "https://example.com/runbook/backup",
  "priority": 4,
  "notify": true,
  "updatedAt": "2026-10-05T07:00:00Z"
}
```

## 10. List-item ticks

`list` items with `action: "complete"` (or `{"type": "complete"}`) get a checkbox; ticking writes `checked: true` and `checkedAt` into data.json. **Read data.json first** on every run: act on every item with `checked: true` (e.g. complete the matching task in TickTick with your own access, using the item's private extras such as `ticktick: {taskId, projectId}`), then rewrite without the handled items. The dashboard only sets `checked`/`checkedAt` and keeps your extras. List only the important or due tasks; the dashboard never queries TickTick. Items with an action need an `id`; `due` is an ISO date or datetime.

## 11. Extending and gotchas

Worked example, an email-summary `table` card. Create it with:

```sh
crontick-dashboard new email-summary --type table --title 'Email summary' --column center --height M
```

That writes this card.json:

<!-- example:card email-summary -->
```json
{
  "$schema": "../../schemas/card-def.json",
  "type": "table",
  "title": "Email summary",
  "layout": {
    "column": "center",
    "height": "M"
  }
}
```

Then write this data.json (a row `link` opens the email; a cell `{text, link}` is its own clickable link):

<!-- example:data email-summary -->
```json
{
  "$schema": "../../schemas/data.table.json",
  "updatedAt": "2026-10-05T07:45:00Z",
  "data": {
    "columns": [
      { "key": "from", "label": "From", "sort": "text" },
      { "key": "subject", "label": "Subject", "sort": "text" },
      { "key": "received", "label": "Received", "sort": "date" }
    ],
    "rows": [
      { "link": "https://mail.example.com/msg/1001", "cells": [{ "text": "Alice Park", "link": "mailto:alice@example.com" }, "Q4 planning notes", "2026-10-05T06:12:00Z"] },
      { "link": "https://mail.example.com/msg/1002", "cells": ["Billing", "Your invoice is ready", "2026-10-04T18:03:00Z"] },
      { "link": "https://mail.example.com/msg/1003", "cells": ["Ops alerts", "Disk usage at 85%", "2026-10-04T14:40:00Z"] },
      { "link": "https://mail.example.com/msg/1004", "cells": ["Bob Chen", "Re: lunch Thursday?", "2026-10-04T11:21:00Z"] },
      { "link": "https://mail.example.com/msg/1005", "cells": ["GitHub", "New comment on your pull request", "2026-10-03T20:05:00Z"] }
    ],
    "defaultSort": { "column": 2, "dir": "desc" },
    "searchable": true
  }
}
```

Gotchas:

- Types are generic: extra keys are preserved untouched; `x-` keys are yours. Table cells are string, number, boolean, null or `{text, link?}`; list items can carry `links: [{text, link}]`; `kpi` cards list several metrics in `data.items`.
- Link schemes: http|https|mailto|ms-outlook only.
- No input widgets in the UI; cards never trigger jobs.
- Never guess the feed dir; always `crontick-dashboard info --json`.
- After upgrading the package, re-run `crontick-dashboard skill install --force` to refresh this file (the owner does this).
