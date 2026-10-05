---
status: draft
summary: OS notifications (notify:true, headless = in-page only) and TickTick completion via official MCP client, with a first-class intent-file fallback applied by a scheduled Claude job.
date: 2026-10-05
---
# PRD: Integrations — OS notifications + TickTick (05)
Repo/branch: crontick-dashboard / `initial-brainstorming` · Depends on: 02-server-core (events, action registry) · Owns: `src/integrations/notify/**`, `src/integrations/ticktick/**` (MCP client, OAuth provider, token store, intents), `docs/ticktick-intents-job.md`, `tests/integrations/**`

## TL;DR
Two plug-ins on 02's two extension points. (1) A notifier subscribes to `card:new|changed` and fires a native toast for `notify:true` cards (batched, click opens the dashboard), no-op on headless. (2) A `ticktick.complete` handler tries the official TickTick MCP; whenever MCP is unconfigured, unauthorised, rejected or unreachable it writes an **intent file** instead and the UI shows "pending". The fallback needs no sign-in, so it is a complete v1 on its own and MCP is an upgrade, not a dependency (brainstorm risk: MCP may reject third-party OAuth clients).

## Problem
Kill criterion: a missed notification (e.g. deploy complete) abandons the product, and a tab-less page can't notify (D16). A list tick must complete the real TickTick task (D18) without registering an API app, and must not silently lose a tick when auth/network fail.

## Goals / Non-Goals
Goals: native notification on Win/mac/Linux desktop; deterministic headless behaviour; TickTick complete via MCP; durable, observable fallback; clear pending/done/failed UI states.
Non-Goals: creating/editing/reading tasks beyond complete (agents populate list cards, D18); web push, ntfy, phone push, notification history (futures.md); triggering jobs (D17); notification action buttons; autostart (missed notifications while server down accepted, D31).

## Requirements
**Notifications (D16)**
- Card with `notify:true`, non-Broken, in window, on `card:new` or `card:changed` (new `updatedAt`) fires one OS notification: title = card title, body = alert/first line summary (<=140 chars, plain text), no `data` leakage beyond that line. Applies to alerts and panels.
- Click opens `http://127.0.0.1:<port>/#card=<id>` in the default browser (03 scrolls/highlights; [OPEN] 03). Where the platform/library can't report clicks, the toast is still shown (click is best-effort).
- Burst control: per card max 1 per `updatedAt` (02's `notified`); global: first 3 within a 10 s window fire individually, the rest collapse into one "N more updates on your dashboard" toast. Alert priority >= `nowPriorityThreshold` is never collapsed away (listed in summary body).
- Headless = in-page only (the page highlight is 03's; 05 only guarantees no OS call and no error). Detection: `config.notifications.os` = `auto` (default) | `on` | `off`. `auto`: Linux without `DISPLAY` and `WAYLAND_DISPLAY` -> off; Linux with a display but no `notify-send` on PATH -> off + one warning; macOS/Windows -> on, except `SSH_CONNECTION` set with no desktop session is still on (cannot detect reliably; `off` override exists). Resolved mode and reason appear in a snapshot `warnings[]` entry when off and in `info`.
- Delivery failure never throws into the watcher; logged, retried never (the in-page highlight is the safety net).
**TickTick (D18)**
- A `list` item with `action:{type:"ticktick.complete",taskId,projectId}` ticks -> optimistic check in UI -> one of: `done` (MCP confirmed), `pending` (intent queued), `failed` (reverted, reason shown).
- Modes `config.ticktick.mode`: `auto` (default: MCP if connected else intent), `mcp` (MCP only; failure = failed), `intent` (always queue; no sign-in needed).
- Already completed or deleted task = success (idempotent, treated as `done`).
- Pending ticks survive restart, are visible in UI until the intent job applies them, and are never applied twice by the server.

## Architecture
```
02 events ─► Notifier ─► NotifyAdapter ─► OS      (config.notifications.os gate; batching)
02 ActionRegistry.register('ticktick.complete', h)
  h(card,item) ─► McpCompleter ──ok──────────────► {ok:true}                (done)
                      │ auth / net / rejected / 5xx
                      └► IntentStore.write ───────► {ok:true,pending:true}  (pending)
                      │ mode=mcp or intent write fails
                      └──────────────────────────► {ok:false,error}         (failed -> 502)
```
**Interface additions requested of 02** (02's handler result is `{ok:true}|{ok:false,error}`): allow `{ok:true, pending:true}`; 02 stores it in `checks` with `pending:true` and surfaces `pendingItems:string[]` beside `checked` in the card snapshot; 05 exposes `getIntentStatus(intentId)` so 02 can clear `pending` -> `checked` when the intent file moves to `intents/applied/` (checked on the existing 10 s rescan). [OPEN-1]

**Notification adapter.** `interface NotifyAdapter { notify({title,body,openUrl}): Promise<void> }`; default `node-notifier` (bundles terminal-notifier on macOS, SnoreToast on Windows, notify-send on Linux; supports click callbacks). It is largely unmaintained (no release for ~4 years), so it sits behind the interface with a documented swap: thin shell-outs (`osascript display notification`, PowerShell WinRT toast with explicit AppUserModelID, `notify-send`) lose click-through on macOS but have zero dependencies. Windows: a toast needs an AppUserModelID; use fixed id `Crontick.Dashboard` (SnoreToast registers a Start-menu shortcut with it on first use) so toasts are attributed and can be allow-listed in Focus Assist. macOS: toasts appear under the notifying binary's identity (terminal-notifier / Terminal) and require owner permission in System Settings. Choice final after the spike. [OPEN-2]

**TickTick MCP client.** `@modelcontextprotocol/sdk` `Client` + `StreamableHTTPClientTransport(new URL('https://mcp.ticktick.com'), {authProvider})`. Documented by TickTick: Streamable HTTP; OAuth (auto refresh; re-auth only after long inactivity/revocation) **or Bearer API token** (TickTick web: avatar > Settings > Account & Security > API Token). Tool: `complete_task({project_id, task_id})` (both required strings) — matches 01's `taskId`+`projectId` (map camel -> snake in the adapter). Connection is per-call lazy and short-lived (connect, call, close; 10 s timeout) — no long-lived socket to babysit.
- Auth sources, in order: (1) bearer token in `secrets/ticktick.json` (`{kind:"token"}`) sent as `Authorization: Bearer`; (2) OAuth tokens (`{kind:"oauth", tokens, clientInfo}`) via an SDK `OAuthClientProvider` (discovery, PKCE, refresh handled by SDK; provider persists `saveTokens`/`saveClientInformation`/`saveCodeVerifier`).
- Token storage: `<data>/secrets/ticktick.json`, dir 0o700, file 0o600, atomic tmp+rename, never in `state.json`/`config.json`/logs/snapshot. Windows ignores POSIX modes; relies on the per-user `%LOCALAPPDATA%` ACL (stated, not hidden).
- **Sign-in (CLI, interface assumption for 06):** `crontick-dashboard ticktick connect [--token]` , `ticktick status`, `ticktick disconnect`. 06 only registers the subcommand group; logic is `src/integrations/ticktick/cli.ts`, runnable without the daemon.
  - Local desktop: `connect` starts a one-shot listener on 127.0.0.1 (callback `http://127.0.0.1:<port>/callback`), opens the browser, exchanges the code, saves, exits. Uses dynamic client registration if the server offers it. [OPEN-3 whether it does]
  - Headless VPS (three ways, in order of simplicity): (a) `connect --token` reads the API token from stdin/prompt — no browser at all; (b) `connect --port 47617` prints the auth URL; owner runs `ssh -L 47617:127.0.0.1:47617 vps` and opens the URL on the laptop so the redirect lands on the VPS listener; (c) run `connect` on a laptop and copy `secrets/ticktick.json`.
  - If the server rejects registration/authorize for a third-party client, `connect` prints the reason, recommends `--token` or `mode: intent`, exits 1; nothing else breaks.
- Error classification (drives pending vs failed): `401`/refresh fail -> `auth` (warning "TickTick needs reconnect" in snapshot `warnings[]`, tick falls back to intent in `auto`); network/timeout/5xx/429 -> `transient` (fallback to intent); tool error -> probe `get_task_by_id` once: task completed or not found -> `done`; otherwise `rejected` -> `failed` with message (no fallback: a retry by the job would fail identically). [OPEN-4: confirm probe tool and error shapes]

**Intent fallback (first-class).** Dir `<data>/intents/` (0o700, created lazily; `applied/` and `rejected/` beneath).
- File `intents/ticktick-complete-<taskId>.json` (name keyed on task = idempotent; repeated ticks overwrite):
```json
{ "version":1, "type":"ticktick.complete", "taskId":"…", "projectId":"…",
  "cardId":"ticktick-today", "itemId":"…", "title":"item text", "createdAt":"ISO", "reason":"auth|transient|mode" }
```
- Written tmp+rename. Also emitted when 02's `checks` records it so the UI shows pending.
- **Applier job** (documented in `docs/ticktick-intents-job.md`, owner creates it in crontick, e.g. every 10 min; works from any Claude session with TickTick access, so it also covers the case where only the claude.ai connector is signed in). Prompt contract, in short: "For each `*.json` in `<intents>` (find via `crontick-dashboard info --json`): call TickTick `complete_task(project_id,task_id)`. On success or task-not-found/already-complete, move the file to `applied/`. On other errors move to `rejected/` with an `.error` note. Never create or edit other tasks. Print one line per file."
- `ticktick status` and `info` report count of queued intents; intents older than 24 h raise a snapshot warning (job not running).

**UI feedback contract** (rendered by 04 list item, state from 02 snapshot): unchecked -> click -> optimistic checked + spinner -> `done` checked; `pending` checked with clock badge + tooltip "queued, applied by job"; `failed` reverted to unchecked + inline reason ("TickTick rejected: …") that clears on next click. `dismiss` actions are unaffected.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|----------|--------|--------------|-----|
| 1 | Fallback status | First-class; `mode: intent` works with zero sign-in | Afterthought on MCP failure | Third-party OAuth rejection is a known risk |
| 2 | Headless auth | Bearer API token + SSH-forward OAuth | Device flow; none | Token is officially documented; no browser needed |
| 3 | MCP connection | Lazy per-call, 10 s timeout | Persistent client | No reconnect/expiry state to manage |
| 4 | Notify library | `node-notifier` behind adapter interface; spike on Win+mac | Shell-outs only; maintained forks | Click-through + bundled helpers; swap cheap |
| 5 | Headless detect | `auto` env heuristics + `on|off` override | Env only | SSH/WSL/desktop cases are ambiguous |
| 6 | Batching | 3 per 10 s then one summary | Fire all; debounce | Bulk rewrites must not spam; nothing silently dropped |
| 7 | Already-done task | Treated as success | Show failure | Idempotent, matches owner intent |
| 8 | Intent filename | Keyed by taskId | Per-tick unique | Dedupe repeated ticks; job idempotent |
| 9 | Secrets | `<data>/secrets/ticktick.json` 0o600 | OS keychain (keytar native dep); env var | No native deps, cross-platform |
| 10 | Rejected (non-transient) error | Failed, no fallback | Always queue | Queueing a doomed call just delays the failure |

## Manual steps
- TickTick sign-in once: `crontick-dashboard ticktick connect` (or create API token and use `--token`); MCP-inspector check of third-party OAuth acceptance (brainstorm risk test).
- Grant notification permission: macOS System Settings > Notifications (terminal-notifier / host app); Windows Settings > Notifications, allow "Crontick.Dashboard", check Focus Assist.
- Create the intents applier job in crontick from `docs/ticktick-intents-job.md`.
- Windows + macOS manual notification test (below); Linux desktop optional.

## Risks / Open Questions
- [OPEN-1] 02 must accept `{ok:true,pending:true}`, a `pendingItems` snapshot field, and the intent-applied check. Without it pending state cannot be shown.
- [OPEN-2] Notification library final choice + macOS click-through + Windows AUMID behaviour: spike on real Win and mac before tasks. node-notifier fork status not verified in this research.
- [OPEN-3] Does mcp.ticktick.com support dynamic client registration / accept a non-Anthropic client id and 127.0.0.1 redirect? Unverified (docs only state "OAuth or Bearer"). Spike with MCP Inspector; design already survives "no".
- [OPEN-4] Official-server tool schema: `complete_task` params (`project_id`,`task_id`) seen via the claude.ai TickTick connector schema, not the raw server; error payloads for completed/deleted tasks unknown; `get_task_by_id` probe assumed.
- [OPEN-5] 01 vs 05 naming: 01 action keys are camelCase (`taskId`,`projectId`); confirmed equivalent, adapter maps. 01 [OPEN-2] can be closed.
- [OPEN-6] 03 owns in-page highlight and `#card=<id>` deep link; 05 assumes both. Highlight trigger (updatedAt newer than UI-local last-seen) not yet specified.
- [OPEN-7] 02 event `card:changed` is in-window only and `notified` is stamped after emit even if OS delivery was skipped (headless or failure) — accepted; [DEFERRED] notify when a window later opens (02 DEFERRED).
- [OPEN-8] 06: register `ticktick connect|status|disconnect` subcommand group; 02 snapshot `warnings[]` carries integration warnings; `config.json` gains `notifications.os`, `ticktick.mode`.
- [DEFERRED] Keychain storage, notification action buttons, intent applier as a built-in server timer.
- Risk: while the server is not running nothing notifies (D31). Risk: `SSH_CONNECTION` on a desktop machine misdetected as headless — `os: on` override.

## Acceptance Criteria
- Unit (fake adapter): `notify:true` new and changed fire once; unchanged restart does not; `notify:false`, Broken, out-of-window do not; 5 cards in 10 s -> 3 toasts + 1 summary; adapter throw does not crash watcher.
- `auto` detection table-tested: Linux no display -> off; display w/o `notify-send` -> off + warning; macOS/Windows -> on; override respected.
- Fake MCP server (SDK in-memory/HTTP): success -> `done`; 401 -> intent written, `pending`, warning raised; timeout -> intent; tool error + probe shows completed/not found -> `done`; other tool error -> `failed` 502, no intent; `mode: intent` never opens a connection; `mode: mcp` never writes intent.
- Intent file schema-valid, tmp+rename, same task twice -> one file; moved to `applied/` -> next rescan clears `pending`.
- `secrets/ticktick.json` mode 0600 (POSIX), absent from snapshot/logs; OAuth refresh persists new tokens.
- `connect` with a stub OAuth server completes via loopback; `--token` works with no browser; rejected registration -> exit 1 with guidance.
- Manual (Win + mac): sample `notify:true` card shows a toast, click opens dashboard, permissions denied -> in-page highlight still works. Real TickTick: tick completes task; disconnected tick queues intent, job applies it, UI flips pending -> done.
