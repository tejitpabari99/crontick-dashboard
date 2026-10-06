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

The card shows the reason. Check it locally: `crontick-dashboard validate <feed>/<id>.json` (file arguments also check id against file name). Common causes: `id-mismatch` (id differs from file name), `schema-invalid` (see the printed JSON pointers), `malformed-json` (half-written or truncated file; write to a temp name and rename), `stale` (older than `staleAfter`; rewrite with a new `updatedAt`), `error` (the card declares an error), `duplicate-id`. See [Broken reasons](reference/errors.md#broken-reasons).

## "Unsupported type" / `unknown-type`

`type` is not one of `markdown`, `table`, `list`, `kpi`, `media`. Check spelling and case; list types with `crontick-dashboard templates`. Also `type` must be allowed for the `kind` (`table` and `media` are panel-only).

## `validate <file>` fails on a template with `id-mismatch`

Templates have ids like `todo-today` but file names like `list.example.json`. Pipe them: `crontick-dashboard templates list | crontick-dashboard validate -` (stdin has no file name, so no id check). When writing a real card, name the file `<id>.json`.

## Card does not appear or update

- Card files must be in the feed dir from `info` (`feedDir`), named `<id>.json`.
- The UI polls (config `pollIntervalMs`, 15-60 s), so allow a short delay.
- A card outside its `show` window is hidden; windows use config `timezone` (default: system zone).
- An id you hid in the UI stays hidden; unhide it from the hidden list.
- Server down: the UI shows only a server-down state, never old cards. Run `daemon status`.

## Notifications do not appear

Check `info`: `Notifications on|off (reason)`. A card must have `notify: true` and a new `updatedAt`, be valid, and be inside its `show` window.

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

The dashboard only edits the card (`complete`) or its own state (`dismiss`). Syncing to another system is the agent's job on its next run.
