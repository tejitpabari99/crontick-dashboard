---
status: in-progress
summary: 12 commit-sized tasks building the server core — paths/config, state store, ingest, archive, snapshot compute, events, HTTP, mutations, actions, write-back, lifecycle.
date: 2026-10-05
---
# Tasks: Server core
Source of truth: [PRD.md](PRD.md). Each task includes its vitest tests (real temp dirs, injectable `Clock`). "01 done" = 01-card-contract tasks finished (validator, `parseDuration`, `windowActive`, scheduling-lib verification); "01#1" = repo scaffold from 01's Task 1.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Paths, config, clock | 01#1, 01 done | done |
| 2 | State store (serial writer) | 1 | done |
| 3 | Feed ingest + watcher | 1, 01 done | done |
| 4 | Archive + retention | 3 | done |
| 5 | computeSnapshot + shared DTOs | 2, 3, 01 done | done |
| 6 | Events, warnings, notified | 3, 4 | done |
| 7 | HTTP server, security, startServer | 5, 6 | done |
| 8 | Mutations: tick, done, hidden, layout | 2, 7 | done |
| 9 | Action registry + dismiss | 8 | done |
| 10 | complete write-back + self-write detection | 9, 3 | in-progress |
| 11 | Lifecycle (daemon, port, pid) | 7 | todo |
| 12 | End-to-end acceptance suite | 8, 10, 11 | todo |

## Task 1 — Paths, config, clock
What it is / what it means: Foundations every other module uses: data-dir resolution, config loading, injectable time.
What changes at a high level: `paths.ts` mirroring crontick (`env-paths`, `CRONTICK_DASHBOARD_HOME`, all paths take `env`); first-run creation of data dir (0o700), `feed/`, `feed/done/`, `archive/`, default `config.json`, no `state.json`. `config.ts` with per-field fallback + warnings, `DEFAULT_PORT = 47616`, port precedence env > config > default, mtime re-read. A `Clock` interface with real and fake impls.
Done when: tests cover first-run layout/perms, each config field's fallback and warning, port precedence, mtime reload.

## Task 2 — State store (serial writer)
What it is / what it means: Durable owner state (acks, hidden, layout, checks, notified, lastSeen) with one in-process writer.
What changes at a high level: `state/*` implementing the version-1 schema, a mutation queue writing `state.json.tmp` + atomic rename (EPERM retry), corrupt-file recovery (rename to `.corrupt-<ts>`, defaults, warning), 30-day `lastSeen` pruning for absent ids.
Done when: 50 concurrent mutations leave valid JSON with all effects; corrupt file recovers with warning; delete+recreate within 30 days keeps acks/layout; pruning after 30 days.

## Task 3 — Feed ingest + watcher
What it is / what it means: Turns `feed/*.json` into a CardStore tolerant of partial writes and bad files.
What changes at a high level: flat `fs.watch` plus 10 s and startup rescan, per-file 200 ms debounce, ignore rules (non-json, dotfiles, `.tmp`, subdirs), read retries, 1 MB cap, calls 01 `validateCardFile` with `filename`. Settling logic for malformed/unreadable (keep previous, retry 250 ms/1 s/3 s) before Broken. Id-collision winner/loser, Broken keys (`broken.id` vs `file:<name>`, `id-mismatch`), deletion removes card.
Done when: truncated file completed within 1 s never yields Broken, stays Broken after 3 s; collisions, id-mismatch, oversized, delete and same-id rewrite behave per PRD.

## Task 4 — Archive + retention
What it is / what it means: D20 nothing-lost history, restart-safe and deduped.
What changes at a high level: on each accepted valid ingest write `archive/<id>/<updatedAt-safe>-<hash8>.json`, skipping when the canonical sorted-key hash equals the newest version. Pruning on ingest and hourly by card `retention` else config default (parse failure → default), never the newest; removed cards pruned by default retention.
Done when: byte-identical and whitespace-only rewrites dedupe, `updatedAt`-only change archives, retention prunes old but keeps newest, deleted-card pruning works.

## Task 5 — computeSnapshot + shared DTOs
What it is / what it means: The pure core: cards + state + config + clock → snapshot.
What changes at a high level: `src/shared/api-types.ts` (type-only `Snapshot`, `ViewCard`, `LayoutItem`) and `compute/*`. Order of checks: 01 `windowActive` (with `config.timezone`; alerts honor `show`) → Broken (`error`/stale/invalid/duplicate; `data` omitted) → ok. Done via acks matching `updatedAt`, Now promotion (cron active, priority ≥ threshold, not Done, Broken included), `collapsed`, hidden list, sort priority desc/`updatedAt` desc/id asc, `checked` from dismiss state, warnings, rev + ETag input.
Done when: fixtures for in/out window (DST, non-local TZ), error/stale/malformed/schema-invalid, Now promotion, Done ack and reset, ordering; Broken has no `data`; ok cards carry `data` in every zone.

## Task 6 — Events, warnings, notified
What it is / what it means: The single extension hook for 05.
What changes at a high level: `server.events` (`card:new|changed|removed` with `{card, prev?, file}`) fired post-validation for non-Broken in-window cards only when `updatedAt` changed; startup scan fires where `updatedAt` ≠ `notified[id]`; `notified` stamped after emit. `server.warnings.set/clear` merged into snapshot.
Done when: restart emits nothing for unchanged cards but emits for changed-while-down; Broken/out-of-window never emit; warnings appear in snapshot.

## Task 7 — HTTP server, security, startServer
What it is / what it means: Hono API surface for reads plus the security envelope.
What changes at a high level: `http/*` with `GET /api/snapshot` (ETag/304), `GET /api/health`, `POST /api/shutdown`, static UI from injected `uiDir` with SPA fallback excluding `/api/*`, no CSP. Loopback-only bind, Host allowlist, mutation guard (JSON content-type + `X-Crontick-Dashboard`), no CORS. `startServer({env,clock,uiDir,logger})` wiring everything, `bindPort` fallback (probe health, notice, `listen(0)`), port file written after listen, removed on stop.
Done when: non-loopback Host or missing header → 403; listens only on 127.0.0.1; occupied default port → free port, correct port file, notice; 304 on matching ETag.

## Task 8 — Mutations: tick, done, hidden, layout
What it is / what it means: The owner-click endpoints that go through StateStore or the feed.
What changes at a high level: `POST /api/alerts/:id/tick` (rename to `feed/done/`, `-<ts>` suffix on collision, cross-device copy+unlink, idempotent when gone), `POST/DELETE .../done`, `PUT/DELETE .../hidden`, `PUT /api/layout`; each returns new `rev`; 404 unknown ids, 500 `{error}` on write failure.
Done when: tick moves file and later rewrite is a fresh card; Done ack resets on new `updatedAt`; hide/unhide/layout persist across restart.

## Task 9 — Action registry + dismiss
What it is / what it means: Server-authoritative item actions (Decision 8).
What changes at a high level: `actions/*` registry and `POST /api/cards/:id/actions {itemId, updatedAt, checked?}`; server reads the action from the current card, never the client. `updatedAt` mismatch → 409, Broken/missing item → 4xx. `dismiss` records in `checks` scoped to `updatedAt` (resets on rewrite), one-way (untick → 400), surfaced as snapshot `checked`.
Done when: dismiss persists and resets on rewrite; untick of dismiss → 400; stale `updatedAt` → 409; `complete` handler slot present for Task 10.

## Task 10 — complete write-back + self-write detection
What it is / what it means: Owner ticks are written into the card file for the agent to act on (owner decision 2026-10-05, Decisions 13-15).
What changes at a high level: preconditions (ok card, item has `complete`, `updatedAt` match, raw hash equals ingested hash else re-ingest + 409); edit raw parsed JSON setting `checked`/`checkedAt` only (untick removes `checkedAt`), `updatedAt` untouched, 2-space + newline serialization; dotfile `.tmp` write then compare-and-rename (stat mtime/size/hash), one retry, else 409 `{error:"card changed, retry"}`; EPERM backoff 5 tries; synchronous re-ingest so response `rev` reflects it. In-memory `selfWrites[file]=hash` makes the watcher refresh without event or archive version. Feed/done cards never written.
Done when: only that item changes, extras and key order preserved, no temp left, no event/archive version, Done ack still valid; simulated agent rewrite mid-flight → no clobber (retry or 409); rename EPERM retried; restart-before-ingest yields no event.

## Task 11 — Lifecycle (daemon, port, pid)
What it is / what it means: Process management that 06's CLI calls (mirrors crontick `daemon/lifecycle.ts` + `ensure.ts`).
What changes at a high level: `lifecycle.ts` with foreground run, detached daemon spawn (`process.execPath`, log fd to `daemon.log`, `shell:false`, `windowsHide`, `unref`), start under exclusive `daemon.lock` waiting on `/api/health` (`app==='crontick-dashboard'`), stop via `POST /api/shutdown` then kill after timeout, status via pid+port files, stale-pid detection, second server on same data dir refuses to start.
Done when: start/status/stop cycle works in tests; stale pid recovered; double start refused; port and pid files cleaned on stop.

## Task 12 — End-to-end acceptance suite
What it is / what it means: Closes the PRD's Acceptance Criteria across modules.
What changes at a high level: a `tests/server` integration pass starting a real server on a temp dir, exercising feed write → snapshot → mutation → restart flows; fill any acceptance bullet not already covered by Tasks 1-11 (e.g. Broken card response without `data`, restart event semantics, write-back race, 50 concurrent mutations over HTTP).
Done when: every Acceptance Criteria bullet in the PRD maps to a passing test.

## Manual steps (owner)
- Windows and macOS smoke of `fs.watch` behavior, rename-over-open-file (EPERM) and `daemon start/stop` (per README owner list); no other human-only steps for 02.
