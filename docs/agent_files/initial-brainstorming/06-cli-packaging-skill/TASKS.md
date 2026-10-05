---
status: in-progress
summary: 10 tasks — package/toolchain completion, build pipeline and asset lookup, CLI skeleton + validate, templates, info, start/daemon, skill install, SKILL.md, package verify scripts, CI + README.
date: 2026-10-05
---
# Tasks: CLI, packaging & Claude skill (06)
Source of truth: docs/agent_files/initial-brainstorming/06-cli-packaging-skill/PRD.md. 06 completes the package layout; 01#1 already created the minimal scaffold (package.json, tsconfig, vitest, eslint, .gitignore), so extend it, don't redo it. Lifecycle logic is 02#11; the CLI only calls it. Each task includes its vitest tests. No `[OPEN]` items remain in the PRD.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Complete package metadata and toolchain | 01#1 | done |
| 2 | Build pipeline, UI copy, `packageAssets()` | 1, 02#7, 03#12 | done |
| 3 | CLI skeleton and `validate` | 1, 01 done | done |
| 4 | `templates` command | 2, 3 | done |
| 5 | `info` command | 2, 3, 02#1, 02#11, 05#3 | done |
| 6 | `start` and `daemon` commands | 2, 3, 02#11 | in-progress |
| 7 | `skill install` command | 2, 3 | todo |
| 8 | SKILL.md and its CI test | 4, 5, 7 | todo |
| 9 | Package verify scripts | 4, 5, 6, 7, 8 | todo |
| 10 | CI workflow and README install section | 9 | todo |

## Task 1 — Complete package metadata and toolchain
What it is / what it means: 01#1 left a minimal scaffold; this brings it to the PRD's final package shape (P2, Scripts, Install & platform).
What changes at a high level: `package.json` gets `bin {"crontick-dashboard": "./dist/cli/index.js"}`, `main/types/exports` to `dist/index.*`, `engines.node >=22.5`, `publishConfig {access: public, provenance: true}`, `files` allowlist (dist, schemas, templates, `src/skill/SKILL.md`, README, LICENSE), no postinstall, runtime deps (commander, hono, @hono/node-server, croner, env-paths, zod) and the full script set (`build`, `build:ui`, `typecheck` root + `ui/`, `format`, `test:watch`, `validate`, `prepublishOnly`, `release`). Split tsconfig(s) so `ui/` keeps its own; add LICENSE; vitest config covers `tests/{contract,server,cli,e2e}`.
Done when: `npm run typecheck`, `lint`, `test` pass; `npm pack --dry-run` lists only the allowed top-level paths (build scripts stubbed until Task 2).

## Task 2 — Build pipeline, UI copy, `packageAssets()`
What it is / what it means: Deterministic build where tsup's `clean` cannot delete the UI (P3, P4, Build pipeline, UI location at runtime).
What changes at a high level: `tsup.config.ts` (ESM, node22, entries `cli/index`, `server/index`, `index`, shebang banner on CLI/server, dts for the library entry, contract bundled), `onSuccess` calling `scripts/copy-ui.mjs` (`ui/dist` to `dist/ui`), `scripts/check-dist-built.mjs`. `npm run build` = `gen:schemas` then `vite build` in `ui/` then tsup. In `src/cli/`, `packageAssets()` walks up to the package.json named `crontick-dashboard` (schemas, templates, SKILL.md) and a `uiDir` resolver relative to the entry; missing `index.html` raises `NOT_BUILT` ("run npm run build"). Unit-test the helper with temp trees.
Done when: clean-checkout `npm run build` yields `dist/cli/index.js`, `dist/server/index.js`, `dist/index.js`, `dist/ui/index.html`; helper tests pass; `NOT_BUILT` message tested.

## Task 3 — CLI skeleton and `validate`
What it is / what it means: Commander ^12 adapter shell with the cross-cutting CLI rules, plus the agent's pre-write check (P1, P5, Commands, `validate`).
What changes at a high level: `src/cli/index.ts` registering commands, `--version`/`--help`, a Node-version guard that runs before heavy imports, single red stderr line on error (stack only with `--verbose` or `CRONTICK_DASHBOARD_VERBOSE=1`), `NO_COLOR`, unified exit-code helper. `validate <file...>`: reads files or `-` (stdin, no filename check), calls 01 `validateCardFile(text,{filename})`; human output `OK`/`BROKEN` with issue lines and warnings; `--json` prints array of `{file, result}` verbatim. Needs no server and never touches the feed dir.
Done when: tests cover 0 all ok, 1 any broken (truncated JSON, bad id, `javascript:` link), 2 missing file, stdin, `--json` shape equals 01's, old-Node message.

## Task 4 — `templates` command
What it is / what it means: Agents' format discovery path (D10; Commands, `templates`).
What changes at a high level: no arg prints a table from `listTypes()` (type, allowed kinds, example path); `<type>` prints `getExample(type)`; `--schema` prints the type's JSON Schema from `schemas/`; `--path` prints file paths; unknown type exits 2 listing valid types. Uses `packageAssets()`.
Done when: tests show output lists exactly the registered types, `templates kpi` output passes `validate`, `--schema` parses as JSON Schema, unknown type exit 2.

## Task 5 — `info` command
What it is / what it means: The frozen contract the skill relies on to locate the feed dir (RESOLVED `info --json` fields).
What changes at a high level: works with daemon stopped; resolves paths from 02 `paths.ts`/`config.ts` and the port via 02's status helper; prints version, data dir, feed dir, URL or "not running", config path, templates/schemas dirs, skill path, and notifications mode/reason from 05's resolver. `--json` emits exactly `{version, dataDir, feedDir, url|null, running, configPath, templatesDir, schemasDir, skillPath, notifications:{mode,reason}}`. Default port quoted from `DEFAULT_PORT`, never hard-coded.
Done when: tests assert the frozen field set with daemon stopped, every path exists in a built tree, `CRONTICK_DASHBOARD_HOME` override respected, human output includes all labels.

## Task 6 — `start` and `daemon` commands
What it is / what it means: Thin calls into 02#11's lifecycle (Daemon, Commands table); no process logic here.
What changes at a high level: `start [--port N]` foreground via `startServer({uiDir})`, prints URL, feed dir and port-fallback notice, Ctrl+C stops cleanly, refuses (prints running URL) if a healthy daemon owns the data dir. `daemon start|stop|status` mapped to lifecycle with the PRD's exit codes (status 3 when stopped, `--json`), log path printed on failure. CLI HTTP calls send the required `Host` and mutation headers.
Done when: tests with a temp data dir: double `daemon start` = one process, status 0 then 3 after stop, stop when not running succeeds, `start` against a running daemon refuses with URL, occupied default port shows fallback notice.

## Task 7 — `skill install` command
What it is / what it means: Owner-run, cross-platform skill delivery (P6, RESOLVED OPEN-3).
What changes at a high level: `skill install [--dir] [--force]` copies the packaged SKILL.md to `<skillsDir>/crontick-dashboard/SKILL.md` (default `os.homedir()/.claude/skills`, homedir injectable), creates missing dirs, tmp+rename, never symlinks. Identical = "already up to date" exit 0; absent = install; different = exit 1 unless `--force`. Prints destination and version; needs no daemon. `ticktick` or other unknown subcommands exit 2.
Done when: tests per acceptance bullet: first install equals packaged file, second is a no-op, modified dest exits 1 then overwritten with `--force`, parent dirs created, not a symlink, Windows-style home path works.

## Task 8 — SKILL.md and its CI test
What it is / what it means: The agent-facing teaching file (P7, Skill sections 1-11).
What changes at a high level: author `src/skill/SKILL.md` with crontick-style frontmatter (name, trigger-phrase description, `allowed-tools: shell`) and a `crontick-dashboard@<version>` header comment. Cover sections 1-11 from the PRD: `info --json` for `feedDir`, envelope table, per-type pointers, read-existing-card-and-act-on-`checked:true` workflow, tmp+rename, validate-before-write, id rules, alert vs panel, `show` defaults, `error` on failure, expandable email-table example, task-list guidance, gotchas. No full schemas. Test checks frontmatter, every type/command named exists, and all required phrases listed in the PRD's skill acceptance bullet.
Done when: the SKILL.md test passes and fails when a named type or required guidance is removed.

## Task 9 — Package verify scripts
What it is / what it means: Proof the real tarball works (P8, Verification).
What changes at a high level: `scripts/verify-tarball.mjs` checks the `npm pack --dry-run` file list (dist with `dist/ui/index.html`, schemas, templates, skill, README, LICENSE; no `src/` except skill, no tests). `scripts/verify-package-install.mjs` packs, installs into a scratch project with isolated `CRONTICK_DASHBOARD_HOME` and non-default port, runs the bin via `node` (no shims), and asserts the PRD list: version, 5 templates validate, broken fixture exit 1, `info --json` paths exist, `daemon start` then health and `GET /`, tmp+rename card appears in snapshot, status 0, stop removes port file, kill-on-fail with Windows rm retries.
Done when: both scripts pass locally after `npm run build`; `validate` script chains verify-tarball.

## Task 10 — CI workflow and README install section
What it is / what it means: Cross-OS gate and owner-facing install docs (Acceptance: 3-OS CI; Manual steps).
What changes at a high level: `.github/workflows/ci.yml` matrix ubuntu/macos/windows x Node 22 and 24 running lint, typecheck, build, test, `gen:schemas` diff, verify-package-install. README install section: `npm i -g`, `npx ... info`, `start`/`daemon`, config keys, `DEFAULT_PORT` (quoted from code), `skill install` with `--force` after upgrades, manual-copy fallback, crontick-job note for ticked tasks.
Done when: workflow YAML lints and its steps run locally; README commands match `--help` output.

## Manual steps (owner)
- `npm publish` (login/2FA, confirm package name availability), or `npm i -g .` from a clone.
- Run `crontick-dashboard skill install` on each machine.
- Windows/macOS manual smoke of `daemon start` (and OS notification with 05); global-install check on Windows.
- Create the crontick job for the agent that completes ticked list items in TickTick.
