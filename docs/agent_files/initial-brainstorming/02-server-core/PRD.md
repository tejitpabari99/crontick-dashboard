---
status: draft
summary: Node/TS server core — data dir, feed watcher, pure state computation (window/Broken/Now/Done), archive+retention, interactions, localhost HTTP API, lifecycle.
date: 2026-10-05
---
# PRD: Server core

Repo/branch: crontick-dashboard · `initial-brainstorming`
Depends on: 01-card-contract (validator, duration/cron parsers)
Owns: `src/paths.ts`, `src/config.ts`, `src/state/*`, `src/feed/*` (watcher, ingest, archive), `src/compute/*`, `src/actions/*` (registry + `dismiss`), `src/http/*`, `src/lifecycle.ts`, `src/shared/api-types.ts` (type-only DTOs: `Snapshot`, `ViewCard`, `LayoutItem`; imported by 03/05/06 with `import type`), `tests/server/**`

## TL;DR
Server turns `<data>/feed/*.json` into a computed **snapshot** (pure function of cards + state + config + clock) and exposes it plus mutations on `127.0.0.1`. Watcher tolerates partial writes; state.json has a single serialized writer; every archived version is deduped by content hash. Hooks for notifications (05) and a handler registry for checkbox actions (05) are the only extension points.

## Problem
Agents write files at arbitrary times, non-atomically, with bad content, and owner clicks concurrently. Server must give the UI one trustworthy view: right cards, right zone, right order, never stale data (D19), nothing lost (D13, D20).

## Goals / Non-Goals
Goals: items 1–7 of SP02 scope; deterministic, clock-injectable computation; crash-safe persistence; cross-platform (Win/mac/Linux).
Non-Goals: UI, card schema (01), OS notifications and TickTick client (05), CLI commands (06), SSE/push API/history viewer/auth/autostart (futures.md, D31).

## Requirements
- First run creates data dir (0o700), `feed/`, `feed/done/`, `archive/`, default `config.json`; no `state.json` until first mutation.
- Valid file → card; malformed/schema-invalid/`error` set/`staleAfter` exceeded → Broken with reason, **data omitted** (D19).
- `show.cron`/`for`: outside window → not in snapshot (not rendered, not searchable); inside → normal (D15).
- Zones: alerts strip; Now (promoted panels); grid; Done tray; hidden list.
- Order everywhere: priority desc, then `updatedAt` desc, then id asc (D13).
- Alert tick moves file to `feed/done/` (D13). Panel Done/reopen, hide/unhide, layout save, item action via API.
- File deleted → card gone (D21). Same-id rewrite → updated in place.
- New/changed valid card emits an event for 05.
- Server reachable only via loopback; mutations reject cross-site requests.

## Architecture
```
feed/*.json ─watch+rescan─► Ingest ──validate(01)──► CardStore (id→card|broken, file meta)
                              │ archive(hash-dedupe)     │ events: new/changed/removed
state.json ◄─StateStore(serial writer)─┐                 ▼
config.json ─► Config                   └──► computeSnapshot(cards,state,config,now) ─► HTTP (Hono)
                                                 ActionRegistry ◄── dismiss (here), ticktick.complete (05)
```
**Consumes from 01** (01 owns; verified against 01 PRD): `validateCardFile(text,{filename}) → {ok:true,card,warnings} | {broken:true,reason,message,issues,id?}` with `BrokenReason = unreadable|malformed-json|not-object|too-large|schema-invalid|unknown-type|id-mismatch`; `parseDuration(str)→ms`; `windowActive(show,now,{timezone})`; `updatedAt` required ISO with offset; `error` may coexist with missing `data`; list items carry `id` whenever `action` is present; `priority` integer 0-5. Ingest always passes `filename`.

**Paths** (mirror crontick `paths.ts`, `env-paths` suffix `''`, `CRONTICK_DASHBOARD_HOME` override): `feed/`, `feed/done/`, `archive/<id>/`, `state.json`, `config.json`, `daemon.pid`, `daemon.port`, `daemon.log`, `daemon.lock`; 05-owned dirs `intents/` (+`applied/`,`rejected/`) and `secrets/` are created lazily by 05, not here. All take `env` for tests.

**Config** `config.json` (all optional, per-field fallback to default + `warnings[]` in snapshot): `port` (default const `DEFAULT_PORT = 47616` exported from `config.ts`; crontick uses 47615; env `CRONTICK_DASHBOARD_PORT` > config > default), `retentionDefault` ("7d"), `nowPriorityThreshold` (working default 3; [OPEN-NOW] 01 said 4), `pollIntervalMs` (30000), `timezone` (IANA; default system local), `notifications.os` (`auto|on|off`, semantics 05), `ticktick.mode` (`auto|mcp|intent`, semantics 05). Re-read when its mtime changes.

**Watcher/ingest.** `fs.watch` on `feed/` (flat, non-recursive; no chokidar dep) + full rescan every 10 s as safety net and at startup (Windows/network FS drop events; macOS/Windows emit duplicates). Per-filename 200 ms debounce, then stat+read. Ignore: non-`.json`, dotfiles, `*.tmp`, subdirs. Read retries on EBUSY/EPERM/ENOENT-race. Size cap 1 MB → Broken. 
- *Partial writes:* 01 `reason:'malformed-json'` (or `unreadable`) ⇒ "settling": keep previous card, retry at 250 ms/1 s/3 s (and while mtime is changing); only then Broken(malformed). Any other 01 `broken` reason = Broken immediately. Skill (06) tells agents to write `.tmp` then rename.
- *Id collision:* winner = newest `updatedAt` (tie: newest mtime); loser becomes a Broken card "duplicate id `X` also in `<file>`" keyed `file:<name>`.
- *Broken keys:* `broken.id` when 01 returns one and reason ≠ `id-mismatch` (card shown Broken in place); otherwise (no id, or `id-mismatch`, so it never shadows the valid card owning that id) key `file:<name>`; title = id or filename. Broken `reason` + `message` come from 01.
- *Deleted file:* card removed from store; archive kept (pruned by default retention).

**Computation** (`computeSnapshot`, pure, called per request; no timers needed for time-driven transitions):
1. Window: call 01 `windowActive(show, now, {timezone: config.timezone})` (active iff latest cron fire ≤ now < fire + `for`; DST via cron lib; `for` absent ⇒ until local end of that day, working assumption pending 01 [OPEN-3]). No `show` ⇒ always. Applies to every kind, alerts included (01 [OPEN-4]). No `show.tz` field exists.
2. Order of checks: outside window → excluded; else `error`/stale/invalid → Broken; else ok.
3. Panel Done iff `acks[id]` equals card `updatedAt` instant → tray (not grid/Now); alerts have no Done.
4. Now: alerts always (strip); panel with `show.cron` active **and** priority ≥ threshold **and** not Done (Broken included, so failures surface). Promoted panels leave `grid`; layout slot kept (D12).
5. `collapsed = kind==='panel' && priority ≤ 1` (D22; expand state is UI-local). 
6. `hidden` from state → separate list, excluded elsewhere.

**Snapshot** `GET /api/snapshot` (ETag/`If-None-Match` → 304):
```ts
{ serverTime, rev, warnings: string[], config:{pollIntervalMs, nowPriorityThreshold},
  zones:{ alerts:id[], now:id[], grid:id[], tray:id[], hidden:id[] },   // each sorted
  cards:{ [id]:{ id,kind,type,title,priority,size?,notify,updatedAt,collapsed,
                 status:'ok'|'broken',
                 reason?: BrokenReason|'error'|'stale'|'duplicate-id',   // broken only; 01 code or runtime code
                 message?: string,                                       // broken only; human one-liner (01 message or runtime text)
                 data? /*omitted if broken; present for ok cards in EVERY zone (alerts, now, grid, tray, hidden)*/,
                 checked?:string[],       // item ids confirmed done (adds to per-item data.checked from 01)
                 pendingItems?:string[] } },  // item ids queued by an integration (05), shown pending
  layout: LayoutItem[] /* opaque RGL {i,x,y,w,h} */ }
```
New-id placement is **UI's** job (03 puts cards lacking a layout entry at the first free slot, then PUTs layout).

**Mutations** (JSON; each returns new `rev`): `POST /api/alerts/:id/tick` · `POST/DELETE /api/cards/:id/done` · `PUT/DELETE /api/cards/:id/hidden` · `PUT /api/layout` · `POST /api/cards/:id/actions {itemId, updatedAt}`. Server looks up the item's `action` in the current validated card (client never names the action); `updatedAt` mismatch → 409. Unknown ids 404.
Also `GET /api/health` → `{app:'crontick-dashboard', pid, dataDir}` (port probe), `POST /api/shutdown` (loopback, for `daemon stop`).

**Security.** Bind `127.0.0.1` only. Reject requests whose `Host` isn't `127.0.0.1:<port>`/`localhost:<port>` (DNS rebinding). Mutations require `Content-Type: application/json` + header `X-Crontick-Dashboard: 1`; no CORS headers (forces failing preflight for foreign pages).

**Persistence (state.json).** `{version:1, acks:{id:updatedAt}, hidden:{id:true}, layout:[], checks:{id:{updatedAt,items:[],pending:{[itemId]:intentId}}}, notified:{id:updatedAt}, lastSeen:{id:iso}}`. One in-process writer: mutations queue, write `state.json.tmp` + rename (atomic; retry EPERM on Windows). Single server per data dir enforced by pid file. Corrupt file → rename `state.json.corrupt-<ts>`, start defaults, add warning. Entries for ids absent from feed are kept 30 days since `lastSeen` (agent delete+recreate must not lose acks/layout), then pruned.

**Alert tick.** `rename(feed/<file>, feed/done/<file>)`; collision in `done/` → suffix `-<ts>`; cross-device fallback copy+unlink. File already gone → idempotent 200. A later rewrite of the same id is a fresh card.

**Archive (D20).** On every accepted valid ingest, write `archive/<id>/<updatedAt-safe>-<hash8>.json`; skip if hash of canonical (sorted-key) JSON equals the newest archived hash ⇒ byte-identical or whitespace-only rewrites dedupe; `updatedAt`-only change is a new version. Rationale vs literal "archive previous": restart-safe (no in-memory previous needed) and previous version is always present. Prune on ingest + hourly: delete versions older than card `retention` (else config default; parse failure ⇒ default), never the newest. Removed cards pruned by default retention.

**Interactions registry (for 05).**
```ts
type ActionHandler = (ctx:{card, item, now:Date}) => Promise<{ok:true, pending?:{intentId:string}}|{ok:false,error:string}>
registry.register('ticktick.complete', handler)   // 'dismiss' built in: marks checks[id]
```
Success ⇒ item recorded in `checks` (scoped to card `updatedAt`, resets on rewrite like D14) and surfaced in `checked`. `{ok:true,pending}` ⇒ recorded under `checks[id].pending`, surfaced in `pendingItems`; on each rescan 02 calls 05 `getIntentStatus(intentId)` and moves applied intents from `pending` to `checked` (rejected ⇒ pending cleared, warning raised). Failure ⇒ 502 `{error}`, item stays unchecked. Unregistered action ⇒ 501.
**Warnings (for 05):** `server.warnings.set(key,msg)` / `.clear(key)`; merged into snapshot `warnings[]` (integration warnings: TickTick needs reconnect, notifications off, stale intents).
**Events (for 05):** `server.events.on('card:new'|'card:changed'|'card:removed', {card, prev?, file})`. Fired after validation, only for non-Broken cards inside window; startup scan fires for cards whose `updatedAt` ≠ `notified[id]` (restart doesn't lose or repeat); server stamps `notified` after emit.

**Static + lifecycle.** No CSP header in v1. Serves built UI from an injected `uiDir` (SPA fallback, `/api/*` excluded). `startServer({env,clock,uiDir,logger}) → {url,port,dataDir,stop()}`; `lifecycle.ts` (mirrors crontick `daemon/lifecycle.ts`+`ensure.ts`; 06 only calls it): foreground run, `daemon` spawn-detached/stop/status via pid+port files, stale-pid detection. Daemon spawn per 06: `spawn(process.execPath,[serverEntry],{detached:true,stdio:['ignore',logFd,logFd],shell:false,windowsHide:true})` + `unref()`, log `<data>/daemon.log`, startup waits on `/api/health` (`app==='crontick-dashboard'`) under an exclusive `daemon.lock`, stop = `POST /api/shutdown` first (Windows has no graceful SIGTERM), then kill after timeout; server entry = `dist/server/index.js`. Port: `bindPort` pattern (fixed default → on EADDRINUSE probe `/api/health`, notice, listen(0)); port file written after listen, removed on stop. Stack: Hono + `@hono/node-server`, `croner`, `env-paths` (as crontick).

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|----------|--------|--------------|-----|
| 1 | Watching | `fs.watch` flat + 10 s rescan | chokidar; poll only | No dep; rescan covers dropped events |
| 2 | Partial writes | Settle/retry before Broken, keep previous meanwhile | Immediate Broken | No flicker; staleAfter still guards |
| 3 | Snapshot | Pure compute per request, ETag | Cached + timers | Time-driven changes free; testable |
| 4 | Archive | Snapshot each accepted version, hash-dedupe | Archive previous on overwrite | Restart-safe, dedupe trivial |
| 5 | State writes | Single serialized atomic writer | Per-request writes | Concurrency-safe |
| 6 | Deleted-id state | Keep 30 d by `lastSeen` | Drop immediately | Delete+recreate keeps acks/layout |
| 7 | Cron TZ | `config.timezone` else system local | UTC | "Wed 9am" means owner's wall clock |
| 8 | Action authority | Server reads action from card | Client sends action | Prevents arbitrary actions (D8) |
| 9 | CSRF/rebinding | Host check + custom header | None (localhost) | Any website can hit loopback |
| 10 | Placement | UI places new cards, saves layout | Server grid logic | Server stays grid-agnostic |
| 11 | Broken panels in Now | Promoted if window+priority qualify | Excluded | Failures must surface |
| 12 | Notify gating | On ingest, in-window, deduped by `notified` | Fire on window open | Simpler; see DEFERRED |

## Risks / Open Questions
- [OPEN-NOW] Now threshold default 3 vs 01's 4: owner call. Recommendation: 3.
- [OPEN] `show.for` omitted default: working assumption end-of-day, owner call in 01 [OPEN-3]. Recommendation: end of local day.
- [RESOLVED: 01 owns validator; 02 adopts `validateCardFile` (see Consumes), no `partial`] .
- [RESOLVED: no `show.tz`; `config.timezone` only] .
- [RESOLVED: `id-mismatch` handled as Broken keyed `file:<name>`] .
- [RESOLVED: snapshot gains `reason`+`message` (Broken), `pendingItems`; handler result gains `pending`; DTOs in `src/shared/api-types.ts`] 03/05 requests.
- [RESOLVED: `DEFAULT_PORT = 47616`] 06 request.
- [OPEN] Verify croner v9 supports previous-run lookup (else use `cron-parser`); same lib as 01.
- [RESOLVED: 04 keeps item visible, checked, disabled until card rewrite] `dismiss` UX.
- [DEFERRED] Notify when a window opens for a card written earlier.
- [DEFERRED] Multi-process state locking (pid file suffices for v1).
- [RESOLVED: pid file + port probe] Two servers on one data dir refuse to start.
- [RESOLVED: 200 ms debounce, 1 MB cap] Windows duplicate events/huge files.
- Risk: `fs.rename` over open file on Windows (EPERM) — retry with backoff, 5 tries.
- Risk: system sleep/clock jump — snapshot is stateless so recovers; `notified` prevents repeats.

## Acceptance Criteria
- Vitest with real temp dirs, injectable `Clock`, fixtures: valid, `error`, stale, malformed, schema-invalid, in/out of window (incl. DST edge, non-local TZ), Now promotion, tick→`done/`, Done ack + reset on new `updatedAt`, archive + retention + dedupe, duplicate id, delete+recreate keeps acks, corrupt `state.json`.
- Truncated file then completed within 1 s never yields a Broken snapshot; stays Broken after 3 s settle.
- 50 concurrent mutations leave `state.json` valid JSON with all effects.
- Broken card response contains no `data`.
- Occupied default port → server on free port, port file correct, notice emitted.
- Non-loopback Host or missing custom header on mutation → 403; server listens only on 127.0.0.1.
- Restart does not re-emit events for unchanged cards, but emits for changed-while-down cards.
- Registering a fake `ticktick.complete` handler: success checks item; failure returns 502 and leaves it unchecked.
