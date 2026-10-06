# Lifecycle implementation

Audience: maintainers changing startup, shutdown, daemon control, or process files.
Non-duplication: user-facing modes, files, and port rules are in [server-lifecycle](../concepts/server-lifecycle.md); CLI flags in `docs/reference/cli.md`. This page covers the code paths. Constants: `src/constants/lifecycle.ts`.

## startServer

`startServer(opts)` in `src/http/server.ts` is the single composition root; the foreground command, the daemon entry, tests, and the smoke harness all call it. Order:

1. `assertUiBuilt`, `ensureDirs`, then `claimPidFile` (may throw `ALREADY_RUNNING`).
2. Create config reader, state store, warnings registry, card events.
3. Create the notifier **before** the watcher starts, so startup-scan events reach it.
4. Create archive and watcher (they reference each other through closures: the archive asks the watcher's store which ids are current).
5. Build the Hono app and attach it to a Node `http.Server`.
6. `bindPort`, write `daemon.port`, then `watcher.start()`, `archive.start()`, an immediate state reconcile, and an hourly reconcile interval.

Failure after claiming the pid calls `stop()` so no stale pid file is left. `stop()` is idempotent (memoized promise) and tears down in order: reconcile timer, notifier (flushes pending summary), watcher, archive, pending `notified` stamps, in-flight reconciles, the HTTP server (`closeAllConnections`), then removes `daemon.port` and releases the pid file (only if it still names this process). The returned `RunningServer` exposes `url`, `port`, `stop`, `events`, `warnings`, `config`, `notifier`.

Test seams on `StartServerOptions`: `clock`, `port` (0 for ephemeral), `notifyAdapter`, `notifyPlatform`, `timers`, `actionTestDeps`, `logger`.

## Port binding

`bindPort(preferred, deps)` tries to listen; on `EADDRINUSE` (and `preferred !== 0`) it probes the occupant with `probeHealth`, emits one notice (another crontick-dashboard with pid and data dir, or a foreign process), and listens on port 0. `probeHealth` fetches `/api/health` with a 1 s timeout and recognizes the `app` field equal to `crontick-dashboard`; any failure counts as foreign.

## Process files

`src/pid.ts`. The server process writes its own `daemon.pid` (not the spawner). `claimPidFile` refuses only when another live pid owns the file **and** its recorded port answers as this app, or no port file exists yet (still starting). A dead pid, or a live pid whose port answers as something else (pid reuse), is taken over. `isPidAlive` uses `process.kill(pid, 0)` and treats `EPERM` as alive.

## daemonStatus

`daemonStatus` in `src/lifecycle.ts` is the single source of truth for "is it running". It reads pid and port files and verifies with `/api/health`:

- live pid, healthy answer with matching pid: running;
- live pid with a port file but no healthy answer: running with `unhealthy: true`, files kept;
- live pid, no port file: not running yet (starting), files kept;
- dead pid: remove both files, report `stale: true` if any existed.

It never removes files of a live pid, so a second server can never start on the same data dir.

## daemonStart

Idempotent. Check status; verify the server entry exists (else `NOT_BUILT`); take `daemon.lock` with exclusive create (`wx`), writing `{ pid, at }`; a stale lock (dead pid or older than 60 s) is removed. Status is checked again under the lock because another starter may have won. Then spawn `process.execPath <entry>` detached with stdout and stderr appended to `daemon.log`, `shell: false`, `windowsHide`. Poll status every 50 ms until running, up to 15 s:

- child exits first: re-check status (a foreground `start` may have won the race), else `DAEMON_START_FAILED` with the log path;
- timeout: SIGKILL the child, `DAEMON_START_TIMEOUT`.

The lock is always released in `finally`. `clock`, `sleep`, and `spawn` are injectable, so tests run the whole state machine with a fake child.

## daemonStop

Not running is success. Otherwise POST `/api/shutdown` (with the mutation headers and explicit `Host`, 2 s timeout), wait up to 5 s for the pid to die; on failure SIGTERM, then SIGKILL, each waiting up to the timeout. The result `mode` is `graceful` or `hard-kill`. Pid and port files are removed only when the process is confirmed dead.

## Entries

`src/server/index.ts` (built to `dist/server/index.js`) resolves the UI dir (`dist/ui`, or env `CRONTICK_DASHBOARD_UI_DIR` for source-run tests), starts the server with a timestamped console logger (stdout goes to `daemon.log`), exits 0 on `POST /api/shutdown`, and handles SIGINT and SIGTERM through `stop()`. Foreground `start` is `runForeground`, which refuses when a healthy server already owns the data dir and returns its URL.
