# crontick-dashboard

Local, modular personal dashboard for viewing outputs of crontick scheduled jobs (e.g. daily mail/meeting rundowns) and other widgets.

Status: research/design phase. Design docs live in `docs/agent_files/`.

## Layout

- `docs/agent_files/` -- design record (research, brainstorm, decisions)

## Install

Requires Node >= 22.5.

```bash
npm i -g crontick-dashboard      # global install
npx crontick-dashboard info      # or run without installing
```

`info` works with the daemon stopped. It prints version, data dir, feed dir, URL (or "not running"), config path, templates dir, schemas dir, skill path. Use `--json` for agents.

### Run

```bash
crontick-dashboard start               # foreground, Ctrl+C stops (--port <n> to prefer a port)
crontick-dashboard daemon start        # background, idempotent, waits until healthy
crontick-dashboard daemon status       # exit 0 running, 3 stopped
crontick-dashboard daemon stop         # not running is success
```

Default port: 47616 (matches `DEFAULT_PORT` in `src/config.ts`). If the port is taken, a free one is used; `info` shows the actual URL.

### Config

`config.json` in the data dir (path shown by `info`). Keys:

| Key | Meaning |
|---|---|
| `port` | preferred port (default `DEFAULT_PORT`) |
| `retentionDefault` | default card retention, e.g. `7d` |
| `nowPriorityThreshold` | priority at/above which a card counts as "now" |
| `pollIntervalMs` | feed poll interval in ms |
| `timezone` | IANA zone for `show` windows (default: system) |
| `notifications.os` | `auto`, `on`, or `off` (OS notifications) |

Invalid values fall back to defaults with a warning. Port precedence: `CRONTICK_DASHBOARD_PORT` env > `config.port` > default.

### Claude skill

```bash
crontick-dashboard skill install            # copies SKILL.md to ~/.claude/skills/crontick-dashboard/
crontick-dashboard skill install --force    # after upgrading the package, overwrite the differing copy
crontick-dashboard skill install --dir <skillsDir>
```

Manual fallback: copy the `skill` path printed by `info` (`skillPath`) to `<skillsDir>/crontick-dashboard/SKILL.md` (a real copy, not a symlink).

### Ticked tasks

Ticking a list item in the dashboard does not update TickTick itself. Create a crontick job for an agent that completes ticked list items in TickTick.

### Notifications

OS notifications (`notifications.os`) may need permission: on macOS allow notifications for your terminal/Node in System Settings > Notifications; on Windows check Settings > System > Notifications and that Focus Assist / Do Not Disturb is off. `info` reports the notification mode and reason.

### Other commands

`validate <file...>` (check cards before writing; `-` for stdin), `templates [type]` (`--schema`, `--path`).
