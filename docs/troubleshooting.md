# Troubleshooting

Start with `crontick-dashboard info` (paths, URL, notification mode) and `crontick-dashboard daemon status`. Run commands with `--verbose` to see error codes. Codes are explained in [errors.md](reference/errors.md).

## Server will not start

- **`ALREADY_RUNNING`**: a healthy server already owns this data dir. `daemon status` shows its URL and pid; use it, or `daemon stop`. A stale pid file (dead process, or a reused pid whose port answers as something else) is detected and taken over automatically; `daemon status` also cleans stale files. If a live but wedged process holds it, `daemon stop` escalates to SIGTERM then SIGKILL.
- **`NOT_BUILT`**: the UI or server entry is missing. From a source checkout run `npm run build`; for an installed package reinstall it.
- **`DAEMON_START_FAILED` / `DAEMON_START_TIMEOUT`**: read the log at `<dataDir>/daemon.log` (path printed by `daemon start`).
- **`LOCK_TIMEOUT`**: a leftover `daemon.lock`. Delete it if no `daemon start` is running.
- **Node too old**: needs Node >= 22.5.

## Port in use

The server prefers port 47616 (override: `--port`, `CRONTICK_DASHBOARD_PORT`, config `port`). If taken it binds a free port and warns, naming the occupant. The real URL is always in `info` or `daemon status`. Invalid `--port` exits 2; an invalid env or config port is ignored (config: with a warning). Remember `Host` must match the port, so reach the dashboard via the printed URL.

## A card shows Broken

The card shows the reason. Check it locally: `crontick-dashboard validate <feed>/<id>` (the folder; it uses the same reader and validators as the server). Common causes: `schema-invalid` (see the printed JSON pointers; usually `data.json`), `malformed-json` (half-written or truncated file; write to `data.json.tmp` and rename), `unknown-type`, `stale` (no update for longer than `staleAfter`; rewrite `data.json` with real new content), `error` (`data.json` declares an `error`), `too-large`. See [Broken reasons](reference/errors.md#broken-reasons).

## A card is missing and a warning appears

A folder that cannot be a card is skipped with a snapshot warning: `card-def-missing` (no `card.json`), `card-def-invalid`, `data-path-invalid` (`data` must be a plain file name inside the folder), `invalid-id` (use lowercase letters, digits, `.`, `_`, `-`), `reserved-id` (`alerts`). Loose files directly in `feed/` are ignored with a warning (cards are folders). `validate <folder>` prints the same `SKIPPED <reason>`. Scaffold correctly with `crontick-dashboard new <id> --type <type>`. See [Skipped folders](reference/errors.md#skipped-folders).

## A card says "No data yet"

Normal after `new`: the folder has a valid `card.json` and no `data.json`. Write `data.json` (shape: `crontick-dashboard templates <type> --file data`). If it never goes away, check the file name matches `data` in `card.json` (default `data.json`) and that it sits inside the card folder.

## "Unsupported type" / `unknown-type`

`type` in `card.json` is not one of `markdown`, `table`, `list`, `kpi`, `media`. Check spelling and case; list types with `crontick-dashboard templates`.

## Validating an example or a document before writing it

Pipe a document with `--as`, since stdin has no folder: `crontick-dashboard templates list --file data | crontick-dashboard validate - --as data --type list`. `--as card` checks `card.json` text; `--as alert` checks an alert file. Stdin takes one document per call and does not check folder-name rules; `new` covers those.

## Card does not appear or update

- Cards are folders `<id>/` with `card.json` (and `data.json`) in the feed dir from `info` (`feedDir`); alerts are `alerts/<id>.json` files.
- A card shows new content only when `data.json` changes; editing `card.json` only re-renders it. A rewrite without an explicit `updatedAt` takes the file time.
- The UI polls (config `pollIntervalMs`, 15-60 s), so allow a short delay.
- A card outside its `show` window is hidden; windows use config `timezone` (default: system zone).
- A card you hid in the UI stays hidden; unhide it from the hidden list. A card you marked Done sits in the Completed section until its data changes (or you Reopen it); the header filter **Alerts** hides every card, including Completed card rows (a `#card=` link to a Done card switches the filter to All in that case).
- Server down: the UI shows only a server-down state, never old cards. Run `daemon status`.

## An alert stays or disappears

Alerts persist until ticked and cannot be hidden. Ticking moves the file to `feed/alerts/.done/`; Completed lists ticked alerts for 7 days and at most the newest 50, but older files stay on disk. There is no un-tick: to show it again, write a new alert file.

## Notifications do not appear

Check `info`: `Notifications on|off (reason)`. A card or alert must have `notify: true` and be new content (a changed `data.json` `updatedAt`, or a new or changed alert file), be valid, and be inside its `show` window. Editing `card.json` never notifies.

- **Linux**: needs `DISPLAY` or `WAYLAND_DISPLAY` set in the server's environment (a daemon started from SSH or cron has neither) and `notify-send` on `PATH` (install libnotify). Otherwise `auto` is off; set `notifications.os` to `on` to force.
- **macOS**: allow notifications for your terminal or Node in System Settings > Notifications; check Focus modes.
- **Windows**: check Settings > System > Notifications and that Focus Assist or Do Not Disturb is off.
- Headless hosts: only the in-page highlight is available.
- Config set to `off`: change `notifications.os` in `config.json`.
- Bursts: more than 3 notifications in 10 s collapse into one summary toast.
- macOS and Windows behavior is not yet verified on real machines (see [ADR 0004](decisions/0004-os-notifications-via-node-notifier.md)).

## Due dates look off by a day or hour

List item `due` labels are rendered in the browser's time zone, not config `timezone` (the snapshot does not carry it yet). A date-only `due` (`YYYY-MM-DD`) is a calendar date; for datetimes include an offset or `Z`. Config `timezone` only affects `show` windows.

## Config changes ignored

Invalid fields fall back to defaults with a warning in the UI; check ranges in [configuration.md](reference/configuration.md) (e.g. `pollIntervalMs` must be 15000-60000). Edits are re-read on file change; a `port` change needs a restart.

## Ticking a list item does not update my task app

The dashboard only edits the card's `data.json` (`complete`) or its own state (`dismiss`). Syncing to another system is the agent's job on its next run.
