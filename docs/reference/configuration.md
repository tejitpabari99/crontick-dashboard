# Configuration reference

## Data directory

All state lives under one data directory, resolved as: env `CRONTICK_DASHBOARD_HOME` if set, else the platform default for the app name `crontick-dashboard` (via `env-paths`, no suffix; e.g. `~/.local/share/crontick-dashboard` on Linux). `crontick-dashboard info` prints the real paths.

| Path | Purpose |
|------|---------|
| `feed/` | Card folders `<id>/{card.json,data.json}` (the interface agents write to) |
| `feed/alerts/` | Alert files `<id>.json` |
| `feed/alerts/.done/` | Ticked alerts, moved here; file time = tick time |
| `schemas/` | Copy of the packaged JSON Schemas so `$schema` paths resolve; written by `new` and server start, overwritten when content differs, never deleted from |
| `state.json` | Server-held UI state (Done acks, hides, checks, notification markers); created on first change |
| `config.json` | User config (below); created as `{}` on first start |
| `daemon.pid`, `daemon.port`, `daemon.log`, `daemon.lock` | Process files |

Directories are created with mode 0700 and `config.json` with 0600 where the OS supports it.

## `config.json`

A JSON object. Missing file means defaults, silently. A non-object or invalid JSON means all defaults plus a warning. Unknown keys are ignored (an old `retentionDefault` is silently dropped). Each invalid field falls back to its default with a warning shown in the UI snapshot. The file is re-read when its mtime changes (no restart needed, except `port`).

| Key | Type | Default | Valid values |
|-----|------|---------|--------------|
| `port` | integer | `47616` | 1-65535 (0 rejected) |
| `nowPriorityThreshold` | integer | `3` | 0-5; cards with priority at or above it count as "now" |
| `pollIntervalMs` | integer | `30000` | 15000-60000; UI snapshot poll interval |
| `timezone` | IANA zone string | system zone | any zone `Intl` accepts; used to evaluate `show` windows |
| `notifications.os` | string | `"auto"` | `auto`, `on`, `off` |

`auto` means: macOS and Windows on; Linux on only with `DISPLAY` or `WAYLAND_DISPLAY` set and `notify-send` on `PATH`; otherwise off. `info` reports the resolved mode and reason.

## Environment variables

| Variable | Effect |
|----------|--------|
| `CRONTICK_DASHBOARD_HOME` | Data directory override |
| `CRONTICK_DASHBOARD_PORT` | Preferred port; invalid values are ignored |
| `CRONTICK_DASHBOARD_VERBOSE` | Verbose CLI errors (see [cli.md](cli.md)) |
| `CRONTICK_DASHBOARD_UI_DIR` | Override the built UI directory of the server entry (source-checkout testing; not for normal use) |

## Precedence (port)

1. `start --port <n>` (foreground only)
2. env `CRONTICK_DASHBOARD_PORT`
3. `config.json` `port`
4. Default `47616`

If the chosen port is in use, the server binds a free port instead and warns (naming the occupant). Always read the real URL from `info`. The server binds `127.0.0.1` only.

## Limits and fixed constants

`data.json` max 1 MiB, `card.json` 64 KiB, alert file 16 KiB; Completed lists ticked alerts for 7 days, newest 50; clock-skew warning at `updatedAt` > 5 min in the future; notification burst limit 3 per 10 s; notification body max 140 chars; state entries for ids absent 30 days are pruned; daemon start timeout 15 s, stop timeout 5 s. These are not configurable.
