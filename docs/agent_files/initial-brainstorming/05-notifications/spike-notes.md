---
status: in-progress
summary: Task 1 spike — Linux/Node 22 load verified, research done; Win/mac run PENDING owner. node-notifier stays Task 2's provisional adapter, shell-out is fallback.
date: 2026-10-05
---
# Spike notes: Win/mac notification adapter (05 Task 1)

## Provisional decision
node-notifier stands as Task 2's adapter (provisional), behind `NotifyAdapter`. The shell-out adapter (`osascript`, PowerShell WinRT toast with AUMID `Crontick.Dashboard`, `notify-send`) is the fallback. Final go/no-go needs the owner run below.

## Verified here (Linux x64, Node v22.23.3, headless, SSH session)
Script: `src/integrations/notify/spike/notify-spike.mjs` (throwaway, ESLint-ignored, not imported by `src`).
- `require('node-notifier')` from ESM via `createRequire` loads fine on Node 22; exports `Notification, NotifySend, NotificationCenter, WindowsToaster, WindowsBalloon, Growl`. No deprecation or load errors. Plain `import notifier from 'node-notifier'` also works (CJS default interop); Task 2 can use either.
- No DISPLAY/WAYLAND_DISPLAY, `notify-send` present at `/usr/bin/notify-send`, no notification daemon: node-notifier does NOT throw. It invokes `notify-send "..." --expire-time 5000`, which fails with `GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown: The name org.freedesktop.Notifications was not provided by any .service files`; delivered as `err` in the callback (exit 1 in the spike). Same result with fake `DISPLAY=:99`.
- Implications for Task 2/6: errors arrive via callback, not exceptions, so the adapter must wrap the callback in a Promise and reject/log there; the `auto` gate (Task 3) is still needed since `notify-send` on PATH does not imply a daemon. On Linux `wait`/`appID` are ignored (no click callback, no `click` event).
- `npm run lint && npm run typecheck && npm test`: all green, 22 files / 353 tests passed.

## Research facts (commands run 2026-10-05)
- `npm view node-notifier version time` -> latest `10.0.1`, published 2022-02-01 (~4.7 years ago); only maintainer `mikaelb`; `time.modified` 2026-06-29 is metadata only. No `deprecated` flag.
- GitHub `mikaelbr/node-notifier`: not archived, last push 2024-06-24, 129 open issues. Recent open issues: #461 (2026-09) bundled terminal-notifier outdated, wants 3.1.0 universal/Apple silicon; #460 (2026-08) `uuid@^8.3.2` flagged GHSA-w5hq-g745-h8pq (low practical risk: we never use uuid v3/v5/v6 with a user buffer); #459 (2026-05) ESM-only discussion; #458 SnoreToast `.exe` needs `chmod +x` (not relevant on Windows); #441/#361 Apple silicon (runs under Rosetta; Rosetta must be installed on M-series macs).
- No Node 22 specific issue found (engines field absent; pure CJS, deps `uuid, which, growly, is-wsl, semver, shellwords`). Package is CJS-only: no ESM entry, must be loaded via `import` interop or `createRequire`.
- Bundled helpers present in install: `vendor/mac.noindex/terminal-notifier.app`, `vendor/snoreToast/snoretoast-x64.exe`, `vendor/notifu/*`.
- Types: `@types/node-notifier` 8.0.5 (DefinitelyTyped, published 2023-11) is behind lib 10.0.1; check option names (`appID`, `wait`) compile in Task 2, otherwise add a local `.d.ts`.
- Forks: none credible found. `gh api repos/mikaelbr/node-notifier/forks` top forks are stale (<=4 stars, last push <=2023). npm `toasted-notifier` 10.1.0 (modified 2025-06-07) is a fork-ish alternative of unknown provenance; not evaluated, not recommended without audit.

## Per-platform go/no-go
| Platform | Toast shown | Click-through | Permission denied | Focus Assist / DND | Node 22 | Go/no-go |
|---|---|---|---|---|---|---|
| Linux (headless, here) | n/a (no daemon; error via callback, no throw) | n/a | n/a | n/a | OK (loads) | N/A (gate handles) |
| Windows | PENDING owner run | PENDING | PENDING | PENDING | PENDING | PENDING owner run |
| macOS | PENDING owner run | PENDING | PENDING | PENDING | PENDING | PENDING owner run |

## Owner instructions
Prereq: Node >= 22.5, clone repo, checkout branch `sp05-notifications`, `npm install`.
Run on each of Windows and macOS (note the OS version, and on mac Intel vs Apple silicon):
```
node src/integrations/notify/spike/notify-spike.mjs
node src/integrations/notify/spike/notify-spike.mjs http://127.0.0.1:7777/#card=abc
```
The script prints JSON lines (`env`, `loaded`, `notify-call`, `event:*`, `callback`, `open-*`) and exits within 60 s. Observe and record:
1. Toast shown? (Windows: attributed to "Crontick.Dashboard"? Start-menu shortcut created? macOS: shown as terminal-notifier or Terminal?)
2. Click-through: click the toast. Does the default browser open the URL? Which `event:`/`callback.response` printed (`activate`/`clicked`)? Try also: ignore it (timeout) and dismiss it, note events.
3. Permission denied: Windows Settings > Notifications turn off "Crontick.Dashboard"; macOS System Settings > Notifications turn off terminal-notifier. Rerun: does the script error, hang until 60 s, or silently succeed?
4. Focus Assist (Windows) / Focus (macOS) on: does the toast still appear in Action Center? Note.
5. Node 22 compat: any warning or exception on load or call. Windows: any SnoreToast/antivirus prompt; macOS: Rosetta/Gatekeeper prompt for terminal-notifier.app.
Record results: fill the table above (replace PENDING), paste the JSON output under a "Raw output" heading below, then set `status: done`. Verdict per platform: GO if toast shown AND (click works OR failure is silent/non-throwing); NO-GO (switch to shell-out adapter for that platform) if toast not shown or the process hangs/crashes.

## Raw output (owner to paste)
Windows:

macOS:
