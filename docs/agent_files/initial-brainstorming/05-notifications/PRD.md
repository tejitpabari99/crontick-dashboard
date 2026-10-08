---
status: approved
summary: OS notifications for notify:true cards (Win/mac/Linux adapter, headless = in-page only). Notifications only: TickTick MCP, OAuth, tokens and intent files were removed (owner 2026-10-05).
date: 2026-10-05
---
# PRD: Notifications (05)
Repo/branch: crontick-dashboard / `initial-brainstorming` · Depends on: 02-server-core (events, warnings registry) · Owns: `src/integrations/notify/**`, `tests/integrations/**`

## TL;DR
One plug-in on 02's event hook: a notifier subscribes to `card:new|changed` and fires a native toast for `notify:true` cards (batched, click opens the dashboard), no-op on headless. This PRD used to also cover TickTick completion via an MCP client with OAuth, tokens, an intent-file fallback and `ticktick` CLI commands. The owner superseded D18 on 2026-10-05: no MCP client, no app registration; ticking a list item writes `checked`/`checkedAt` back into the card file (02) and the owning agent completes the task in TickTick on its next run (06 skill). Nothing TickTick-related lives in the dashboard any more.

## Problem
Kill criterion: a missed notification (e.g. deploy complete) abandons the product, and a tab-less page can't notify (D16). The server must raise a native toast for cards that must interrupt, deterministically on desktop and silently on headless machines.

## Goals / Non-Goals
Goals: native notification on Win/mac/Linux desktop; deterministic headless behaviour; burst control; click opens the card.
Non-Goals: anything TickTick (no MCP client, OAuth, tokens/secrets, `ticktick` CLI, `ticktick.mode`, intents folder/applier job; write-back lives in 02, agent-side completion in 06 skill); web push, ntfy, phone push, notification history (futures.md); triggering jobs (D17); notification action buttons; autostart (missed notifications while server down accepted, D31).

## Requirements
**Notifications (D16)**
- Card with `notify:true`, non-Broken, in window, on `card:new` or `card:changed` (new `updatedAt`) fires one OS notification: title = card title, body = alert/first line summary (<=140 chars, plain text), no `data` leakage beyond that line. Applies to alerts and panels. Server write-backs of ticked items (02) never fire (`updatedAt` unchanged, no event).
- Click opens `http://127.0.0.1:<port>/#card=<id>` in the default browser (03 scrolls + highlights, specced in 03 deep-link bullet). Where the platform/library can't report clicks, the toast is still shown (click is best-effort).
- Burst control: per card max 1 per `updatedAt` (02's `notified`); global: first 3 within a 10 s window fire individually, the rest collapse into one "N more updates on your dashboard" toast. Alert priority >= `nowPriorityThreshold` is never collapsed away (listed in summary body).
- Headless = in-page only (the page highlight is 03's; 05 only guarantees no OS call and no error). Detection: `config.notifications.os` = `auto` (default) | `on` | `off`. `auto`: Linux without `DISPLAY` and `WAYLAND_DISPLAY` -> off; Linux with a display but no `notify-send` on PATH -> off + one warning; macOS/Windows -> on, except `SSH_CONNECTION` set with no desktop session is still on (cannot detect reliably; `off` override exists). Resolved mode and reason appear in a snapshot `warnings[]` entry when off and in `info`.
- Delivery failure never throws into the watcher; logged, retried never (the in-page highlight is the safety net).

## Architecture
```
02 events (card:new|changed) ─► Notifier ─► NotifyAdapter ─► OS      (config.notifications.os gate; batching)
02 server.warnings.set/clear ◄── Notifier (notifications off / delivery problems)
```
**Notification adapter.** `interface NotifyAdapter { notify({title,body,openUrl}): Promise<void> }`; default `node-notifier` (bundles terminal-notifier on macOS, SnoreToast on Windows, notify-send on Linux; supports click callbacks). It is largely unmaintained (no release for ~4 years), so it sits behind the interface with a documented swap: thin shell-outs (`osascript display notification`, PowerShell WinRT toast with explicit AppUserModelID, `notify-send`) lose click-through on macOS but have zero dependencies. Windows: a toast needs an AppUserModelID; use fixed id `Crontick.Dashboard` (SnoreToast registers a Start-menu shortcut with it on first use) so toasts are attributed and can be allow-listed in Focus Assist. macOS: toasts appear under the notifying binary's identity (terminal-notifier / Terminal) and require owner permission in System Settings. Choice final after the spike. [RESOLVED: node-notifier behind NotifyAdapter; first task is a Win/mac spike; shell-out adapter is the fallback if spike fails]

**Interface used from 02:** `server.events.on('card:new'|'card:changed', ...)` (only for non-Broken, in-window cards whose `updatedAt` changed; stamps `notified` after emit) and `server.warnings.set(key,msg)/.clear(key)`. No action handlers, no state, no secrets, no extra data dirs.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|----------|--------|--------------|-----|
| 1 | Scope | Notifications only | Also TickTick MCP/intents (original) | Owner 2026-10-05: MCP assumed to reject third-party clients, no app registration; write-back-to-file in 02 replaces it (D18 superseded) |
| 2 | Notify library | `node-notifier` behind adapter interface; spike on Win+mac | Shell-outs only; maintained forks | Click-through + bundled helpers; swap cheap |
| 3 | Headless detect | `auto` env heuristics + `on|off` override | Env only | SSH/WSL/desktop cases are ambiguous |
| 4 | Batching | 3 per 10 s then one summary | Fire all; debounce | Bulk rewrites must not spam; nothing silently dropped |

## Manual steps
- Grant notification permission: macOS System Settings > Notifications (terminal-notifier / host app); Windows Settings > Notifications, allow "Crontick.Dashboard", check Focus Assist.
- Windows + macOS manual notification test (below); Linux desktop optional.

## Risks / Open Questions
- [RESOLVED: TickTick MCP client, OAuth, token store, `ticktick connect|status|disconnect` CLI, `ticktick.mode`, intents folder and applier job all removed (owner superseded D18, 2026-10-05); ticking writes back into the card file (02), the agent completes in TickTick (06 skill)] was OPEN-3, OPEN-4 and the integration interface items.
- [RESOLVED: node-notifier behind NotifyAdapter; first task is a Win/mac spike; shell-out adapter is the fallback if spike fails] Notification library final choice + macOS click-through + Windows AUMID behaviour: spike on real Win and mac before tasks. node-notifier fork status not verified in this research. Recommendation: node-notifier behind the adapter.
- [RESOLVED: accepted as described] 02 event `card:changed` is in-window only and `notified` is stamped after emit even if OS delivery was skipped (headless or failure) — accepted; [DEFERRED] notify when a window later opens (02 DEFERRED).
- [RESOLVED: 03 specs both: highlight when `updatedAt` != local `seen[id]`; `#card=<id>` scrolls + highlights] was OPEN-6.
- [DEFERRED] Notification action buttons.
- Risk: while the server is not running nothing notifies (D31). Risk: `SSH_CONNECTION` on a desktop machine misdetected as headless — `os: on` override.

## Acceptance Criteria
- Unit (fake adapter): `notify:true` new and changed fire once; unchanged restart does not; `notify:false`, Broken, out-of-window do not; 5 cards in 10 s -> 3 toasts + 1 summary; adapter throw does not crash watcher; a server write-back of a ticked item fires nothing.
- `auto` detection table-tested: Linux no display -> off; display w/o `notify-send` -> off + warning; macOS/Windows -> on; override respected.
- Manual (Win + mac): sample `notify:true` card shows a toast, click opens dashboard, permissions denied -> in-page highlight still works.
