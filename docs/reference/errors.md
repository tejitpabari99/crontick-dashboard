# Errors reference

Source of truth: `src/constants/error-codes.ts`. Codes appear in HTTP bodies (`{ error, code }`), in CLI output with `--verbose` (`code: <CODE>`), and in `AppError.code`. Exit codes are in [cli.md](cli.md#exit-codes).

## HTTP codes

| Code | Status | Trigger | What to do |
|------|--------|---------|-----------|
| `HOST_FORBIDDEN` | 403 | `Host` header is not `127.0.0.1:<port>` or `localhost:<port>` | Use the URL from `info`; do not proxy or use another hostname |
| `MUTATION_HEADER_REQUIRED` | 403 | Non-GET `/api` call without `Content-Type: application/json` and `X-Crontick-Dashboard: 1` | Send both headers |
| `NOT_FOUND` | 404 | Unknown API route, missing static asset | Check the path |
| `BAD_REQUEST` | 400 | Malformed URL encoding | Fix the URL |
| `INVALID_JSON` | 400 | Request body is not JSON | Send valid JSON |
| `INVALID_BODY` | 400 | Actions body is not `{ itemId, updatedAt, checked? }` | Fix the body |
| `INVALID_LAYOUT` | 400 | Layout body is not an array of `{ i, x, y, w, h }` | Fix the body |
| `CARD_NOT_FOUND` | 404 | No card with that id | Reload; the file may be gone |
| `CARD_BROKEN` | 400 | Card is Broken, so Done/action refused | Fix the card file |
| `CARD_CHANGED` | 409 | Card changed since the client loaded it (message: `card was updated; reload and retry`) | Reload and retry |
| `NOT_AN_ALERT` | 400 | Tick on a card that is not a valid alert | Only alerts can be ticked |
| `ITEM_NOT_FOUND` | 404 | No list item with that id on the card | Reload |
| `ITEM_NO_ACTION` | 400 | Item has no (known) action | Add `action` to the item in the card |
| `DISMISS_NOT_UNCHECKABLE` | 400 | `checked: false` sent for a `dismiss` item | `dismiss` is one-way |
| `INTERNAL` | 500 | Unexpected server error | See the daemon log (`daemon start` prints its path) |

## Lifecycle and CLI codes

| Code | Exit | Trigger | What to do |
|------|------|---------|-----------|
| `NOT_BUILT` | 1 | UI or server entry missing (source checkout not built) | `npm run build`, or reinstall the package |
| `ALREADY_RUNNING` | 1 | `start` found a healthy server on this data dir; or the server process found a live owner of the pid file | Use the printed URL, or `daemon stop` first |
| `DAEMON_START_FAILED` | 1 | Daemon process exited during startup | Read the log path in the message |
| `DAEMON_START_TIMEOUT` | 1 | Not healthy within 15 s (process is killed) | Read the log |
| `DAEMON_STOP_TIMEOUT` | 1 | Daemon still alive after stop timeout | `kill -9` that pid or check permissions |
| `LOCK_TIMEOUT` | 1 | `daemon.lock` held (stale after 60 s) while starting | Remove `daemon.lock` if no start is running |
| `PACKAGE_ROOT_NOT_FOUND` | 1 | Package root could not be located | Reinstall the package |
| `SKILL_NOT_FOUND` | 1 | Packaged `SKILL.md` missing | Reinstall |
| `SKILL_DIFFERS` | 1 | Installed skill differs and no `--force` | Rerun `skill install --force` |
| `INVALID_PORT` | 2 | `start --port` not an integer 0-65535 | Fix the value |
| `UNKNOWN_TYPE` | 2 | `templates <type>` with an unregistered type | Use a listed type |
| `FILE_UNREADABLE` | 2 | `validate <file>` cannot read the file | Check path and permissions |

## Broken reasons

A card folder whose `card.json` parsed but whose content cannot be shown renders as a Broken card with one of these reasons. Cards are never partially shown. `validate` and the snapshot use the same reasons (alert files use the same set except `unknown-type`).

| Reason | Meaning |
|--------|---------|
| `unreadable` | Not valid UTF-8 text, the data file could not be read, or it could not be processed |
| `malformed-json` | Empty or invalid JSON |
| `not-object` | Top-level value is not an object |
| `too-large` | Over the size cap (1 MiB for a data file) |
| `schema-invalid` | Data file envelope or `data` violates the contract, or the payload does not fit the type; issues list JSON pointers |
| `unknown-type` | `type` in `card.json` is not registered ("Unsupported type" in the UI) |

`duplicate-id` is unreachable for card folders: folder names are unique within `feed/`, and the folder name is the id. Kept as a note pending SP02 confirmation.

## Skipped folders

A folder that cannot be treated as a card at all is skipped. It is not rendered as a card; the user sees a snapshot warning instead. Dot-prefixed folders (e.g. `.done`) are ignored silently, with no warning.

| Reason | Cause | What the user sees |
|--------|-------|--------------------|
| `card-def-missing` | Folder has no `card.json` | Snapshot warning, no card |
| `card-def-invalid` | `card.json` is unreadable, empty, invalid JSON, not an object, over its size cap, or violates the card definition schema (any issue other than the `data` path) | Snapshot warning, no card |
| `data-path-invalid` | The `data` path in `card.json` breaks the data path rule | Snapshot warning, no card |
| `invalid-id` | Folder name is not a valid card id | Snapshot warning, no card |
| `reserved-id` | Folder name is reserved (`alerts`) | Snapshot warning, no card |

## No data yet

Not an error. When `card.json` is valid but the data file it points to is absent, the folder yields a `no-data` result and the card renders muted ("no data yet") until the data file appears. It is not Broken and raises no warning.
