# CLI reference

Binary: `crontick-dashboard` (package `bin`). Requires Node >= 22.5; older Node prints `error: crontick-dashboard requires Node >=22.5 (found X). Please upgrade Node.` and exits 1.

```
crontick-dashboard [--verbose] [-V|--version] [-h|--help] <command>
```

## Global options

| Option | Meaning |
|--------|---------|
| `--verbose` | Print stack traces on unexpected errors and the machine `code:` line on coded errors. Also enabled by env `CRONTICK_DASHBOARD_VERBOSE` set to anything other than empty or `0`. |
| `-V, --version` | Print the package version. |
| `-h, --help` | Help for the program or a command. |

Errors go to stderr as one line (red when stderr is a TTY and `NO_COLOR` is unset).

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Command failed (broken or skipped card in `validate`, `new` on an existing id, runtime/lifecycle error, unexpected error) |
| 2 | Usage or input error (unknown option/command, missing argument, invalid `--port`, invalid card id or option value, unknown type, unreadable file) |
| 3 | `daemon status`: not running |

Error codes behind these exits: [errors.md](errors.md).

## Commands

### `new <id> --type <type> [options]`

Scaffold a card folder `<feed>/<id>/` containing `card.json` only. The agent then writes `data.json` once; until it does, the card shows "No data yet". Works with the server stopped.

| Option | Meaning |
|--------|---------|
| `--type <type>` | Required: `markdown`, `table`, `list`, `kpi` or `media` |
| `--title <s>` | Card title (default: the id with dashes as spaces, capitalised) |
| `--column <c>` | `left`, `center` or `right` |
| `--order <n>` | Integer order within the column |
| `--height <h>` | `S`, `M`, `L` or `auto` |
| `--priority <n>` | 0-5 |
| `--force` | Rewrite `card.json` of an existing card; never touches `data.json` or other files |
| `--with-example` | Also write the type's example `data.json` (for trying the dashboard; shows sample data as if real) |
| `--json` | Print `{ id, dir, cardPath, dataPath, schemasSynced }` |

- Only flags you give appear under `layout` in `card.json`; it starts with `"$schema": "../../schemas/card-def.json"`. The generated text is self-checked with the same parser the server uses.
- The folder is built under a dot-prefixed temp name and renamed into place, so the server never sees an empty folder.
- Also creates `feed/` and `feed/alerts/` if missing (never anything else) and copies the packaged JSON Schemas into `<data>/schemas/`; sync problems are warnings on stderr.
- Output: `created <dir>` then `next: write <dir>/data.json (example: crontick-dashboard templates <type>)`.
- Errors: id reserved (`alerts`), dot-prefixed or not a valid id: exit 2 (`BAD_REQUEST`); unknown `--type`: exit 2 (`UNKNOWN_TYPE`); bad `--column`, `--height`, `--order` or `--priority`: exit 2 (`INVALID_OPTION`); id already exists without `--force`: exit 1 (`CARD_EXISTS`).

### `validate [--json] [--as card|data|alert] [--type <type>] [--id <id>] <path...>`

Validate before or after writing. Uses the same reader and validators as the server. A path is dispatched by what it is:

- A directory: a card folder (`card.json` plus the data file it names).
- `card.json` or `data.json`: validates the folder that contains it.
- Any other `.json` file: an alert file; its id is the file name stem.
- `-`: stdin, one document per call, and `--as` is required (`card`, `data` or `alert`). `--as data` also needs `--type <type>` and checks the data.json text against that type, so an agent can validate content before writing it. `--id` sets the id for stdin documents (default `stdin`). Folder name rules (id pattern, reserved names) are not checked on stdin; `new` covers them.

Text output per path (prefixed `# <path>` when several): `OK <id> (<type>)` plus `  warning: ...` lines; `NO DATA <id> (<type>)` with a note to write `data.json` (valid, exit 0); `BROKEN <reason>: <message>` or `SKIPPED <reason>: <message>`, each followed by one `  <json-pointer>: <message>` line per issue. `--json` prints an array of `{ "path", "result" }`, the result being the validator result verbatim (see [library-api.md](library-api.md)). Reasons: [errors.md](errors.md).

Exit 0 if everything is OK or has no data yet; 1 if any path is Broken or Skipped; 2 for unusable input: an unreadable path (`FILE_UNREADABLE`), stdin without `--as`, `--as data` without `--type`, `--as` without stdin, an invalid `--as` value, or more than one document on stdin (`INVALID_OPTION`), or an unknown `--type` (`UNKNOWN_TYPE`).

### `templates [type] [--schema [which]] [--file <name>] [--path]`

- No argument: table of `TYPE  SUMMARY  FOLDER` for the five types plus `alert` (folder = absolute template path).
- `<type>`: print `# card.json` and `# data.json` blocks for that type's example folder (for `alert`, one `# alert.json` block).
- `--file card|data`: print that one raw file only, pipe-friendly (for `alert`, the alert file).
- `--schema [card|data|payload]`: print a JSON Schema. `data` (default) is `data.<type>.json`, `card` is `card-def.json`, `payload` is the bare `<type>.json`; `alert` has `alert.json`.
- `--path`: print the example folder and the schema file paths.
- Types: `markdown`, `table`, `list`, `kpi`, `media`, `alert`. Unknown type (or unknown `--schema` / `--file` value): exit 2 (`UNKNOWN_TYPE`).

### `info [--json]`

Works with the server stopped. Fields: `version`, `dataDir`, `feedDir`, `url` (null when not running), `running`, `configPath`, `templatesDir`, `schemasDir`, `skillPath`, `notifications` (`{ mode: "on"|"off", reason }`). Text form is an aligned key/value list; when not running the URL row reads `not running (default port 47616)`. The `--json` field names are a frozen contract used by the shipped skill.

### `start [--port <n>]`

Run the server in the foreground; Ctrl+C (SIGINT/SIGTERM) or `POST /api/shutdown` stops it. Prints `crontick-dashboard running at <url>`, `Feed dir: <path>`, `Press Ctrl+C to stop`. Server warnings (e.g. port fallback) go to stderr.

- `--port <n>`: preferred port, integer 0-65535 (0 = OS-assigned). Falls back to a free port if taken. Invalid: exit 2 (`INVALID_PORT`). Port precedence: see [configuration.md](configuration.md).
- Another healthy server owns the data dir: exit 1 (`ALREADY_RUNNING`), message names its URL and pid.
- UI build missing: exit 1 (`NOT_BUILT`).

### `daemon start`

Start the detached background server. Idempotent: prints `started: <url> (pid N, port P)` or `already running: ...`, then `Log: <path>`. Waits until `/api/health` answers (timeout 15 s). Failures exit 1: `NOT_BUILT`, `DAEMON_START_FAILED`, `DAEMON_START_TIMEOUT`, `LOCK_TIMEOUT`.

### `daemon stop`

Requests shutdown over HTTP, then SIGTERM, then SIGKILL (5 s per step). Prints `not running` (success, exit 0) or `stopped (pid N, graceful|hard-kill)`. Still alive after timeout: exit 1 (`DAEMON_STOP_TIMEOUT`).

### `daemon status [--json]`

Exit 0 running, 3 stopped. Text: `running[ (unhealthy)]: <url> (pid N)` or `stopped`, plus `Data dir:`. `--json` prints `{ running, pid?, port?, url?, dataDir, unhealthy?, stale? }`. Stale pid/port files are removed as a side effect (`stale: true` reported).

### `skill install [--dir <skillsDir>] [--force]`

Copy the packaged `SKILL.md` to `<skillsDir>/crontick-dashboard/SKILL.md` (default skills dir `~/.claude/skills`) as a regular file, never a symlink, written atomically. Prints `installed <path> (vX)` or `already up to date`. A differing installed copy without `--force`: exit 1 (`SKILL_DIFFERS`). Missing packaged file: `SKILL_NOT_FOUND`.
