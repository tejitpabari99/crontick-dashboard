---
status: draft
summary: crontick-dashboard CLI (start, daemon, info, validate, templates), npm package/build layout, and the SKILL.md that teaches agents to write cards.
date: 2026-10-05
---
# PRD: CLI, packaging & Claude skill (06)
Repo/branch: crontick-dashboard / `initial-brainstorming` · Depends on: 01-card-contract, 02-server-core · Owns: `src/cli/**`, `src/skill/SKILL.md`, `package.json`, `tsup.config.ts`, `tsconfig*.json`, `eslint.config.js`, `vitest.config.ts`, `scripts/{copy-ui,verify-package-install,verify-tarball,check-dist-built}.mjs`, `.github/workflows/ci.yml`, README install section

## TL;DR
One npm global package `crontick-dashboard` (D28) with one bin of the same name. The CLI is a thin Commander adapter (as crontick's `src/cli/index.ts`) over 01's validator and 02's `startServer`/lifecycle. tsup builds CLI + server; Vite builds the UI (03) and tsup `onSuccess` copies it into `dist/ui`. SKILL.md (shipped in the package) teaches agents the card format by pointing at `info`, `templates`, `validate`. A pack-and-install smoke proves the tarball works on Windows/macOS/Linux.

## Problem
Owner installs once and runs `crontick-dashboard start`; agents (crontick jobs, Claude sessions) must learn the format where they already look (D10). Without packaging rules, the built UI, schemas, templates and skill don't ship, and cross-OS daemon handling drifts from crontick's proven approach.

## Goals / Non-Goals
Goals: D27 command set; deterministic package contents; reproducible build; agent-ready skill; install verified per OS.
Non-Goals: autostart/service install (D27, D31); a `write`/push CLI (futures.md); server internals (02), UI (03/04), notifications/TickTick (05); card schema (01); Docker/per-OS installers (D28); npm publish and git remote (owner).

## Requirements
**Commands** (all take `--help`; errors = one red line on stderr, no stack unless `--verbose`/`CRONTICK_DASHBOARD_VERBOSE=1`; `NO_COLOR` honored)
| Command | Behavior | Exit |
|---|---|---|
| `start [--port N]` | Foreground server (Ctrl+C stops). Prints URL, feed dir, and any port-fallback notice (02). Refuses if a healthy daemon already owns the data dir (prints its URL). | 0 clean stop; 1 error |
| `daemon start` | Idempotent detached start; waits for `/api/health`; prints URL, pid, port note. | 0 running; 1 failed (prints log path) |
| `daemon stop` | Graceful `POST /api/shutdown`, fallback kill after timeout. Not running = success message. | 0; 1 if still alive |
| `daemon status` | running/stopped, pid, URL, data dir. `--json`. | 0 running; 3 stopped (scriptable) |
| `info` | Works with daemon stopped. Prints: version, data dir, **feed dir**, URL (or "not running"), config path, templates dir, schemas dir, skill path. `--json` for agents. | 0 |
| `validate <file...>` | Reads each file (`-` = stdin, no filename check) and calls `validateCardFile(text,{filename})`. Human output: `OK id (type, kind)` + warnings, or `BROKEN reason: message` + one line per `issues[]` (`path: message`). `--json` prints an array of `{file, result}` (01 `ValidationResult` verbatim). | 0 all ok; 1 any broken; 2 usage/unreadable file |
| `templates [type]` | No arg: table of types (`listTypes()`), allowed kinds, example path. `<type>`: prints `getExample(type)`; `--schema` prints its JSON Schema; `--path` prints file paths. Unknown type → exit 2 listing valid types. | 0/2 |
| `--version`, `--help` | Standard | 0 |

`validate` is the agent's pre-write check; it must not need a running server or touch the feed dir.

**Install & platform**
- `npm install -g crontick-dashboard` → `crontick-dashboard` on PATH on Windows/macOS/Linux; `npx crontick-dashboard info` works.
- Node >=22.5 enforced via `engines`; CLI prints a clear message on older Node before importing anything heavy.
- No postinstall scripts (supply-chain surface, offline-safe).

**Skill** (`src/skill/SKILL.md`, shipped). Frontmatter mirrors crontick: `name: crontick-dashboard`, `description` (trigger phrases: "show on my dashboard", "write a dashboard card", "raise an alert", "notify me"), `allowed-tools: shell`. Sections:
1. Purpose / when to use; identity of the feed dir: **run `crontick-dashboard info --json` and use `feedDir`; never guess a path**.
2. Card envelope (field table condensed from 01, links to `schemas/envelope.json`) + minimal example.
3. Per-type pointers: `crontick-dashboard templates <type>` and `templates <type> --schema`; one-line "use for" per type (markdown, table, list, kpi, media); `link` on rows/items (deep links, D8); `action` only `dismiss` / `ticktick.complete`.
4. Workflow: build JSON → `crontick-dashboard validate file` → write atomically (write `<id>.json.tmp` in the feed dir then rename to `<id>.json`; 02 ignores `*.tmp`) → rewrite same id to update (bump `updatedAt`, which resets Done, D14).
5. Id rules (01: lowercase slug, `[a-z0-9._-]`, ≤64, equals filename stem, no Windows-reserved names).
6. Alert vs panel: alerts persist until ticked, only markdown/list/kpi, unmissable; panels live in the grid; priority meaning (≥ Now threshold surfaces during `show` window; ≤1 collapses).
7. `show` (`cron` 5-field + `for` duration), `staleAfter` (set it for recurring jobs: stale = Broken, never old data, D19), `retention`, `notify: true` only for things that must interrupt.
8. Failure: write `error: "<reason>"` rather than stale data; `data` may then be omitted.
9. Gotchas: extras allowed but preserved untouched; never delete other agents' files; no UI inputs; cards never trigger jobs (D17); durations are single-unit (`26h`).
The skill must not restate full schemas (drift); it links to `templates`/`schemas` and a CI test checks every template/type named in SKILL.md exists in `listTypes()`.

**Owner install of the skill.** crontick documents no installer (its plugin/skill installer was removed, ADR 0002); the file simply ships in the package. v1: README gives copy instructions; `info` prints the skill path. Copy (not symlink) is the documented default (symlinks need privileges on Windows) into `~/.claude/skills/crontick-dashboard/SKILL.md` (Windows: `%USERPROFILE%\.claude\skills\...`); re-copy after upgrades. Whether to add `crontick-dashboard skill install` is [OPEN-3].

## Architecture
**Repo layout (cross-cutting assumption; 01/02 file ownership kept as they stated, 02's modules are flat under `src/`):**
```
package.json  tsup.config.ts  tsconfig.json  eslint.config.js  vitest.config.ts
src/contract/   (01)           src/cli/ (06)            src/skill/SKILL.md (06)
src/{paths,config,lifecycle}.ts, src/{state,feed,compute,actions,http}/  (02, server)
src/index.ts    library export: contract only (validateCardFile, listTypes, getExample, types)
ui/             (03/04) Vite+React app; own tsconfig; builds to ui/dist
schemas/ templates/   (01, generated/committed)      scripts/  tests/{contract,server,cli,e2e}/
dist/           cli/index.js  server/index.js  index.js  index.d.ts  ui/   (build output, gitignored)
```
**Build pipeline** (`npm run build`): `gen:schemas` (01 script; CI diffs) → `vite build` in `ui/` → `tsup` → `onSuccess` copies `ui/dist` → `dist/ui` (tsup `clean:true` wipes `dist`, so UI builds elsewhere first; same pattern as crontick's `cpSync` of its dashboard). tsup: ESM, target node22, platform node, entries `cli/index`, `server/index`, `index`; shebang banner on CLI/server; contract compiled into both bundles (01). UI libs are devDependencies (bundled by Vite); runtime deps: `commander`, `hono`, `@hono/node-server`, `croner`, `env-paths`, `zod` (+05's).

**UI location at runtime.** CLI/server resolve `uiDir = resolve(dirname(fileURLToPath(import.meta.url)), '../ui')` (both entries live one level under `dist/`) and pass it to 02's `startServer({uiDir})` (02: injected). Missing `index.html` → `NOT_BUILT` error "run npm run build" (dev checkout). Package root for `schemas/`, `templates/`, `SKILL.md` resolved by walking up to the nearest `package.json` named `crontick-dashboard`; one helper `packageAssets()` used by `info`/`templates`.

**Daemon.** 02 owns `src/lifecycle.ts` (foreground, spawn-detached, stop, status, stale-pid) mirroring crontick `daemon/lifecycle.ts` + `ensure.ts`; 06 only calls it. 06 requirements on it, from crontick's proven spawn: `spawn(process.execPath,[serverEntry],{detached:true, stdio:['ignore',logFd,logFd], shell:false, windowsHide:true, env})` + `unref()`; log to `<data>/daemon.log` (path shown on failure); startup wait polls `/api/health` (`app==='crontick-dashboard'`, rejects other products on the port) with an exclusive lock file against concurrent `daemon start`; stop = HTTP shutdown first because Windows has no graceful SIGTERM. CLI HTTP calls (health, shutdown) must send `Host: 127.0.0.1:<port>`, and mutations `Content-Type: application/json` + `X-Crontick-Dashboard: 1` (02 security).

**Consumes:** 01 `validateCardFile`, `listTypes`, `getExample`, `schemas/`, `templates/`, `parseDuration` (not needed). 02 `startServer({env,clock,uiDir,logger})→{url,port,dataDir,stop()}`, lifecycle API, `paths.ts` (`feedDir`, `portFilePath`), `GET /api/health`, `POST /api/shutdown`. **Provides:** CLI binary, package, skill, `packageAssets()`, verify scripts.

**Scripts** (mirror crontick): `build`, `build:ui`, `gen:schemas`, `typecheck` (root + `ui/`), `lint`, `format`, `test` (vitest run), `test:watch`, `verify-package-install`, `validate` (= lint && typecheck && build && test && verify-tarball), `prepublishOnly` (= validate), `release`. `package.json`: `type: module`, `bin: {"crontick-dashboard": "./dist/cli/index.js"}`, `main/types/exports` → `dist/index.*`, `engines.node >=22.5`, `publishConfig {access: public, provenance: true}`, `files`: `dist`, `schemas`, `templates`, `src/skill/SKILL.md`, `README.md`, `LICENSE`.

**Verification (`scripts/verify-package-install.mjs`, idea from crontick):** `npm pack` real tarball → install in scratch project with isolated `CRONTICK_DASHBOARD_HOME` and a non-default `CRONTICK_DASHBOARD_PORT` → run the installed bin by resolving its `bin` path and invoking with `node` (no npx wrapper; avoids leaked processes) → assert: `--version`; `templates` lists 5 types; every shipped template passes `validate` (exit 0), a broken fixture exits 1 with `--json` parse; `info --json` paths exist (schemas, templates, skill, `dist/ui/index.html`); `daemon start` → `GET /api/health` ok and `GET /` returns HTML; write a card with tmp+rename into `feedDir` → appears in `GET /api/snapshot`; `daemon status` 0; `daemon stop` → port file gone; kill-on-fail cleanup with Windows rm retries. `verify-tarball` checks `npm pack --dry-run` file list (no `src/` except skill, no tests). CI matrix: ubuntu/macos/windows × Node 22 and 24.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| P1 | Arg parser | Commander ^12 | yargs, citty | crontick parity |
| P2 | Bins | Single `crontick-dashboard`; server entry is `dist/server/index.js` spawned by lifecycle, not a public bin | Extra `-daemon` bin as crontick | Less PATH surface; nothing to run by hand |
| P3 | UI build handoff | Vite → `ui/dist`, tsup `onSuccess` copy to `dist/ui` | Vite emits into `dist` | tsup `clean` would delete it |
| P4 | Asset lookup | Walk up to package root; UI by relative path from entry | Embed assets in bundle | Plain files; inspectable; trivial in tarball |
| P5 | validate exit codes | 0 ok / 1 broken / 2 usage-IO; `--json` emits 01 result verbatim | 0/1 only | Agents can tell "bad card" from "bad invocation" |
| P6 | Skill delivery | Ships in package, copied by owner | Auto-install on `npm i` | No postinstall; owner controls `~/.claude` |
| P7 | Skill content | Pointers to `templates`/`schemas`, no duplicated schemas | Inline full schemas | Single source (01) |
| P8 | Install smoke | Real tarball into scratch dir, 3-OS CI | `--dry-run` only | Proves it runs, as crontick |
| P9 | Windows spawn | `windowsHide:true` added to crontick's recipe | Copy exactly | Avoids a flashing console window |

## Manual steps (owner only)
- Add git remote; create the GitHub repo (also needed for `provenance`).
- `npm publish` (npm login/2FA), choose package scope/availability of the name `crontick-dashboard`.
- Copy `SKILL.md` into `~/.claude/skills/crontick-dashboard/` on each machine (until [OPEN-3]).
- Windows/macOS manual smoke of `daemon start` (+ OS notification, with 05).

## Risks / Open Questions
**01 vs 02 mismatches (06 builds on 01's interface; 02 must align):**
- [OPEN-1] Validator API: 01 = `validateCardFile(text,{filename}) → {ok:true,card,warnings} | {broken:true,reason,message,issues,id?}`; 02 assumes `validateCardText(text) → {ok:false,reason,partial?:{id,title,kind}}`. 06 uses 01's. 02 must adopt it (`partial` ≈ `id` only; title/kind not provided).
- [OPEN-2] Now threshold default: 01 says 4, 02 says 3. Also `show.for` default (01 OPEN-3 undecided; 02 assumes end of day); `id`≠filename stem Broken (01) not handled in 02; 02 assumes optional `show.tz`, 01 defers it. 06's skill text depends on these, so it will use "see `templates`"-style wording until settled.
- [OPEN-4] Default port constant not stated in 02 (crontick uses 47615). Proposal: pick a distinct constant, say 47616; `info` and README quote 02's constant, never hard-code.
- [OPEN-5] Lifecycle ownership: 06 scope says CLI mirrors lifecycle/ensure; 02 owns `src/lifecycle.ts`. Assumed 02 implements, 06 consumes (requirements above). Confirm; also which file the daemon is spawned from (assumed `dist/server/index.js`).
- [OPEN-6] 02 file layout is flat `src/{state,feed,...}`; this PRD assumes it as-is rather than a `src/server/` folder (cosmetic; one rename if owner prefers).
- [OPEN-3] Add `crontick-dashboard skill install [--dir]` (copy, `--force`, prints destination)? Proposed yes if cheap; default v1 = docs only. Owner call.
- [OPEN-7] `info --json` field names are a contract for the skill; freeze at task time: `{version, dataDir, feedDir, url|null, running, configPath, templatesDir, schemasDir, skillPath}`.
- [RESOLVED: no autostart] D27/D31.
- [RESOLVED: Node >=22.5 kept] D28, though dashboard does not use `node:sqlite`; parity with crontick.
- [DEFERRED] `--open` browser flag, shell completions, `crontick-dashboard doctor`, npx-only usage docs.
- Risk: `npm i -g` on Windows builds shims that wrap node; verify script avoids them but a manual global-install check on Windows is still advised.
- Risk: skill copy goes stale after upgrade; `info` prints version and skill file carries `crontick-dashboard@<version>` header comment so agents/owner can spot drift.

## Acceptance Criteria
- `npm pack` tarball contains `dist/` (with `dist/ui/index.html`), `schemas/`, `templates/`, `src/skill/SKILL.md`, README, LICENSE; nothing else of substance.
- `crontick-dashboard validate` on each template: exit 0; on truncated JSON / bad id / `javascript:` link: exit 1 with reason and issue paths; missing file: exit 2; `--json` output parses and equals 01's result shape.
- `templates` lists exactly the registered types; `templates kpi` prints a valid card; `--schema` prints valid JSON Schema.
- `info --json` works with no daemon, and `feedDir` there is where a card written per SKILL.md appears in the snapshot.
- `daemon start` twice = one process; `daemon status` exit 0 then, 3 after `daemon stop`; port file removed; occupied default port yields fallback notice and correct URL.
- `start` while a daemon runs refuses and prints the running URL.
- `verify-package-install` passes on ubuntu, macos, windows (Node 22 and 24) in CI.
- SKILL.md CI test: frontmatter present; every type and CLI command it names exists; contains tmp+rename and `validate`-before-write guidance.
- Running `npm run build` from clean checkout then `node dist/cli/index.js start` serves the UI.
