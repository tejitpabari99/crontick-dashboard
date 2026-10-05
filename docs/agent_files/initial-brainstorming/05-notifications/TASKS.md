---
status: in-progress
summary: 7 commit-sized tasks — Win/mac spike deciding the adapter, adapter, headless gate, notifier core, burst control, failure/warnings, wiring + acceptance.
date: 2026-10-05
---
# Tasks: Notifications
Source of truth: [PRD.md](PRD.md). OS notifications only (TickTick was removed 2026-10-05). All code lives under `src/integrations/notify/**` with tests in `tests/integrations/**`; unit tests use a fake `NotifyAdapter` and the injectable `Clock` from 02. "02#N" = task N in [02-server-core/TASKS.md](../02-server-core/TASKS.md).

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Win/mac notification spike (decides adapter) | 01#1 | owner-pending (Linux part done; Win/mac run is owner-only) |
| 2 | NotifyAdapter + chosen implementation | 1 | in-progress |
| 3 | Headless gate (`notifications.os` auto/on/off) | 02#1 | todo |
| 4 | Notifier core: events to toasts | 2, 3, 02#6 | todo |
| 5 | Burst control | 4 | todo |
| 6 | Failure isolation + warnings | 4, 02#6 | todo |
| 7 | Server wiring + acceptance suite | 5, 6, 02#7, 02#10 | todo |

## Task 1 — Win/mac notification spike (decides adapter)
What it is / what it means: Resolved OPEN-2: `node-notifier` is the default but unverified on real machines (unmaintained ~4 years); this early task settles the adapter before any other code depends on it.
What changes at a high level: A throwaway script (kept under the notify folder, not shipped) that fires a toast via `node-notifier` on Windows and macOS with title, body, `Crontick.Dashboard` AppUserModelID, and a click callback opening a URL. Owner runs it on real Win and mac; record outcomes (toast shown, click-through, permission-denied behaviour, Focus Assist, Node 22 compatibility) in a short findings note appended to the PRD-adjacent spike notes. Decision: node-notifier stands, or the shell-out adapter (`osascript`, PowerShell WinRT toast with AUMID, `notify-send`) becomes the default.
Done when: a written go/no-go per platform exists and names the adapter Task 2 builds first.

## Task 2 — NotifyAdapter + chosen implementation
What it is / what it means: Architecture's `NotifyAdapter { notify({title, body, openUrl}): Promise<void> }` seam, so the library is swappable.
What changes at a high level: Define the interface and one production adapter per the spike result (node-notifier with fixed AUMID `Crontick.Dashboard` and best-effort click opening `openUrl` in the default browser; or the shell-out set, losing macOS click-through). Platform dispatch is internal. Where clicks cannot be reported the toast is still shown. A fake adapter for tests ships alongside.
Done when: adapter conforms to the interface, unit-tested with the underlying library/process spawn stubbed (arguments, AUMID, click handler wiring); manual smoke on the dev platform shows a toast.

## Task 3 — Headless gate (`notifications.os` auto/on/off)
What it is / what it means: Deterministic desktop vs headless decision (Decision 3).
What changes at a high level: A pure function from `{platform, env, notifySendOnPath, configValue}` to `{enabled, reason, warning?}`. `auto`: Linux with neither `DISPLAY` nor `WAYLAND_DISPLAY` → off; display but no `notify-send` → off plus one warning; macOS/Windows → on (including `SSH_CONNECTION`); `on`/`off` override. Reads the `notifications.os` key from 02's config.
Done when: table test covers every PRD detection row and overrides; resolved mode and reason are exposed for warnings and `info`.

## Task 4 — Notifier core: events to toasts
What it is / what it means: The plug-in on 02's event hook (D16).
What changes at a high level: Subscribe to `server.events` `card:new|changed`; skip cards without `notify:true`. Build title = card title and body = alert/first-line summary, plain text, truncated to 140 chars, no `data` beyond that line (alerts and panels). `openUrl` = `http://127.0.0.1:<port>/#card=<id>`. Gate on Task 3 result: when off, make no adapter call. Relies on 02 emitting only for non-Broken, in-window, changed-`updatedAt` cards; no per-card dedupe of its own (02's `notified`).
Done when: fake-adapter tests: new and changed fire once; `notify:false` does not; body truncation and plain-text stripping; correct deep-link URL; gate off means zero calls.

## Task 5 — Burst control
What it is / what it means: Global spam limit with nothing silently dropped (Decision 4).
What changes at a high level: Sliding 10 s window on the injected `Clock`: first 3 notifications fire individually; the rest collapse into one "N more updates on your dashboard" toast emitted when the window closes. Alerts with priority at or above `nowPriorityThreshold` are never collapsed away: they appear named in the summary body.
Done when: 5 cards in 10 s produce 3 toasts plus 1 summary; high-priority overflow is listed in the summary; a new window after expiry starts fresh; deterministic via fake clock.

## Task 6 — Failure isolation + warnings
What it is / what it means: Delivery problems never reach the watcher; off-state is visible.
What changes at a high level: Wrap every adapter call so throws and rejections are caught and logged, never retried and never propagated into 02's emit path. Use `server.warnings.set/clear` for: notifications off (with resolved mode and reason, from Task 3) and delivery problems; clear when resolved. Resolved mode also reported in `info`.
Done when: an adapter that throws or rejects does not crash or stall the watcher and later cards still notify; off-state warning appears in the snapshot with the reason; no warning when on.

## Task 7 — Server wiring + acceptance suite
What it is / what it means: Registers the notifier at startup and closes the PRD's Acceptance Criteria.
What changes at a high level: Hook the notifier into `startServer` (02#7) with the real adapter, config and port, in a way that costs nothing when disabled. Integration tests under `tests/integrations/` start a server with a fake adapter: restart with unchanged cards fires nothing, changed-while-down fires; Broken and out-of-window cards do not fire; a server write-back of a ticked item (02#10) fires nothing; headless run makes no OS call and raises no error. Add a short Windows/mac manual test checklist.
Done when: every unit and detection bullet in the PRD's Acceptance Criteria maps to a passing test; the Manual (Win + mac) bullet is listed for the owner.

## Manual steps (owner)
- Run the Task 1 spike and the final manual test on Windows and macOS: sample `notify:true` card shows a toast, click opens the dashboard, denied permission still leaves the in-page highlight working.
- Grant permissions: macOS System Settings > Notifications (terminal-notifier / host app); Windows Settings > Notifications, allow "Crontick.Dashboard", check Focus Assist. Linux desktop test optional.
