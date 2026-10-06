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
| 1 | Command failed (broken card in `validate`, runtime/lifecycle error, unexpected error) |
| 2 | Usage or input error (unknown option/command, missing argument, invalid `--port`, unknown template type, unreadable file) |
| 3 | `daemon status`: not running |

Error codes behind these exits: [errors.md](errors.md).

## Commands

### `validate [--json] <file...>`

Validate card files before writing them to the feed dir. `-` reads stdin. Same validator as the server.

- File arguments: the file's basename (minus `.json`) must equal the card `id` (`id-mismatch` otherwise). Stdin has no file name, so no id check: use `validate -` for templates (their ids do not match their `*.example.json` names).
- Text output per file: `OK <id> (<type>, <kind>)` plus `  warning: ...` lines, or `BROKEN <reason>: <message>` plus one `  <json-pointer>: <message>` line per issue. With several files each is prefixed by `# <file>`.
- `--json`: prints an array of `{ "file", "result" }`, the result being the `ValidationResult` verbatim (see [library-api.md](library-api.md)).
- Exit 0 if every file is OK, 1 if any is broken, 2 if a file cannot be read (`FILE_UNREADABLE`).

### `templates [type] [--schema] [--path]`

- No argument: table of `TYPE  KINDS  EXAMPLE` (example = absolute template path).
- `<type>`: print that type's example card JSON.
- `--schema`: print the type's JSON Schema instead.
- `--path`: print the example path and schema path (two lines).
- Types: `markdown`, `table`, `list`, `kpi`, `media`. Unknown type: exit 2 (`UNKNOWN_TYPE`).

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
