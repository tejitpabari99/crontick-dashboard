# Testing

Audience: contributors writing tests or preparing a release.
Non-duplication: the commands list is in `AGENTS.md`; the release procedure in `RELEASING.md`; structure of the code under test in [implementation](../implementation/README.md). This page covers test layers, patterns, CI, and the pre-release checklist.

## Layers

| Layer | Location | Tooling | Guarantees |
|-------|----------|---------|------------|
| Contract | `tests/contract/` | vitest (node) | Schemas, validator reasons, templates validate and match generated JSON Schemas (ajv), window and duration helpers |
| Server | `tests/server/` | vitest (node) | Ingest, watcher, events, archive, state, compute, HTTP routes and guards, actions and write-back, lifecycle (including injected clock, sleep, spawn), error codes, an end-to-end flow |
| CLI | `tests/cli/` | vitest (node) | Commands through `run(argv, fakeIo)`, assets, built-bin guard, README default port |
| Integrations | `tests/integrations/` | vitest (node) | Gate, notifier, adapter (fake notifier and spawn), failure isolation, server wiring |
| Skill | `tests/skill/` | vitest (node) | Install behavior; `SKILL.md` matches the real CLI (`--help` command list, version, types) |
| Utils | `tests/utils/` | vitest (node) | Retry, timers, ports, errors, guards |
| UI | `ui/tests/` | vitest (jsdom) + Testing Library | Store, mutations, placement, registry, per-type bodies, zones, theme (including contrast of derived palettes) |
| Browser smoke | `tests/smoke/smoke.spec.ts` | Playwright (chromium) | Real server from source plus built `ui/dist`: every type renders its real body (never "Unsupported type"), no console errors |
| Packaging | `scripts/verify-*.mjs` | node | Tarball shape and a real packed install (see [build-and-package](../implementation/build-and-package.md)) |

`vitest.config.ts` defines two projects: `root` (`tests/**/*.test.ts`, node) and `ui` (from `ui/vite.config.ts`, jsdom).

## Running

```sh
npm test                      # all vitest projects
npx vitest run tests/server/state.test.ts       # one file
npx vitest run -t "pattern"   # by name
npm run test:watch
npx vitest list               # enumerate without running
npm run test:smoke            # build:ui, then Playwright; needs npx playwright install chromium
npm run validate              # lint + typecheck + build + test + verify-tarball
npm run verify-package-install  # real tarball install (after a build)
```

The built-CLI guard test skips itself without `dist/`; run `npm run build` first for full coverage (it writes `dist/`, `ui/dist/`, `schemas/`).

## Injection pattern

Production code takes its side effects as parameters (P5), and tests pass fakes; avoid real sleeps and real OS calls.

- **Clock.** `fakeClock(start)` from `src/clock.ts` has `set` and `advance`. Pass it to `startServer({ clock })`, `createStateStore`, `daemonStart`, `createArchive`, and `moveToDone`.
- **Timers.** Components accept `TimeoutTimers` or `IntervalTimers` (`src/utils/timers.ts`). Feed tests use vitest fake timers (`vi.useFakeTimers()`), so debounce and settle schedules (200 ms; 250 ms, 1 s, 3 s) run instantly. The UI store takes `setTimeout`, `clearTimeout`, `now`, and a visibility `doc`.
- **Notify adapter.** `FakeNotifyAdapter` (`src/integrations/notify/fake.ts`) records `calls` and can be set to `throw` or `reject` through `failWith`. `startServer({ notifyAdapter, notifyPlatform })` plus a `fakeClock` exercises the whole path from file write to toast, including bursts.
- **Lifecycle.** `daemonStart` takes `clock`, `sleep`, `spawn`; a fake child with `exitWith` simulates failed startup without a process. Tests that need a real daemon use an isolated `CRONTICK_DASHBOARD_HOME` temp dir and `port: 0`.
- **Filesystem races.** `actionTestDeps` (`rename`, `sleep`, `hooks.beforeCompare`) forces the write-back compare-and-swap window; the state store takes `renameFn` and `retryDelayMs` to simulate Windows `EPERM`.
- **CLI.** Build a `CliIo` with captured stdout and stderr; call `run([...], io)` and assert the returned exit code.

Rules (AGENTS.md): every bug fix adds a regression test; assert observable behavior; no order dependence. Always use a temp `CRONTICK_DASHBOARD_HOME` and clean up in `afterEach`.

## CI

`.github/workflows/ci.yml` runs on push to `main` and every pull request.

| Job | Matrix | Steps |
|-----|--------|-------|
| `ci` | ubuntu, macos, windows x Node 22, 24 (`fail-fast: false`) | `npm ci`, verify-lockfile, check:changesets, lint, typecheck, build, test, regenerate schemas and `git diff --exit-code schemas/`, verify-tarball, verify-package-install, advisory `npm audit signatures` |
| `smoke` | ubuntu, Node 22 | install Playwright chromium, build, `test:smoke` |
| `verify-package` | ubuntu, Node 22, after `ci` | build, pack dry-run, verify-tarball, verify-package-install |

A weekly `Security Audit` workflow runs `npm audit` on production dependencies. CI never shows real OS notifications.

## Pre-release checklist

Automated (all must be green; the Release workflow reruns most):

- [ ] `npm run validate`
- [ ] `npm run test:smoke`
- [ ] `npm run verify-lockfile` and `npm run verify-package-install`
- [ ] `schemas/` has no diff after `npm run gen:schemas`
- [ ] `npm run check:changesets` passes; changesets describe user-visible changes
- [ ] Docs current ([reference](../reference/), [concepts](../concepts/), this folder)

Manual, once per release that touches notifications, the notifier dependency, or the UI link flow, on **Windows and macOS** (Linux desktop optional) with a built package and a running server (`notifications.os` = `auto`). The full procedure and result table are in `docs/agent_files/initial-brainstorming/05-notifications/spike-notes.md`, "Final manual test":

1. A card with `"notify": true` dropped into the feed shows a toast with the title and a one-line body.
2. Clicking the toast opens `http://127.0.0.1:<port>/#card=<id>` and highlights the card.
3. Rewriting the card with a newer `updatedAt` shows a second toast; same `updatedAt` or a server restart shows none.
4. Denying notification permission (and Focus Assist or Focus on): no toast, no server error, in-page highlight still works.
5. Five `notify: true` cards within 10 s: 3 toasts plus 1 summary toast.
6. `notifications.os` = `off`: no toasts, and the snapshot warning shows the reason.

Record the OS version (and Intel vs Apple silicon).
