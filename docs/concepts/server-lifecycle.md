# Server lifecycle

Audience: users running the dashboard and contributors working on the process model.
Non-duplication: command flags and exit codes are owned by `docs/reference/cli.md`; the on-disk process files and locking mechanics are in `docs/implementation/`; the rationale for no autostart is in [ADR 0001](../decisions/0001-custom-build-and-runtime-model.md).

## One server per data directory

The server is one small Node process serving the API and the built UI on `127.0.0.1`. Exactly one runs per data directory. It is started by the owner, in the style of the sibling crontick project:

- **Foreground.** `start` runs it in the terminal until interrupted.
- **Background.** `daemon start` launches a detached process, waits until it reports healthy, and is idempotent. `daemon status` and `daemon stop` complete the set. Stopping a server that is not running is success.
- **Inspect.** `info` works even with the server stopped; it prints the data and feed paths, the URL (or "not running"), and other locations agents need.

There is no autostart and no OS service. If the machine reboots or the process dies, nothing is shown or notified until it is started again. Cards written meanwhile are not lost: they are ingested at the next start.

## Process files

The server writes its own pid file, a port file, and a log in the data dir; a lock file serializes concurrent `daemon start` calls. A pid file alone is never trusted: a stale or reused pid is detected by checking that the recorded port answers as this application, and then taken over. Process-file state is cleaned up on stop.

## Port

A fixed default port is preferred, with an environment variable and config override. If the port is taken by something else, a free one is chosen and recorded, so `info` is always the source for the real URL. A port held by another dashboard instance is reported, not stolen.

## Shutdown

Shutdown is requested over the guarded HTTP API (works on every platform, including Windows), with signals as a fallback. The server stops its watcher, timers, and notifier, then exits. Stop waits for the process to actually exit and reports a timeout instead of hanging.

## Startup

On start the server ensures the data directories exist (private permissions where the OS supports them), loads config (invalid values fall back to defaults with a warning), scans the feed, and starts the watcher, archive pruning, and notifier. State is created lazily on the first change.

## Platforms

Linux, macOS, and Windows on Node 22.5 or newer. Rename operations that can fail transiently on Windows are retried. The CLI refuses to run on an unsupported Node version with a clear message.
