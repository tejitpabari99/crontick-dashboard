# Build and package implementation

Audience: maintainers touching the toolchain, packaged contents, or release checks.
Non-duplication: the toolchain decision is [ADR 0003](../decisions/0003-toolchain-and-distribution.md); the release procedure is in `RELEASING.md` (not repeated here); command list in `AGENTS.md`. This page explains what each build step and check does.

## Build pipeline

`npm run build` runs, in order:

1. `gen:schemas`: `scripts/gen-schemas.ts` regenerates `schemas/` from zod (see [contract](contract.md)). Output is committed.
2. `build:ui`: `vite build ui` writes `ui/dist` (`base: './'`, so assets resolve under any mount).
3. `tsup`: one config array in `tsup.config.ts`, ESM only, target `node22`, no splitting, no sourcemaps:
   - `cli/main` and `server/index` (first entry, `clean: true`, shebang banner). `onSuccess` runs `scripts/copy-ui.mjs`, which copies `ui/dist` to `dist/ui` (tsup's clean would otherwise wipe it, which is why the UI builds elsewhere first);
   - `cli/index` as a separate bin entry with `./main.js` external and a shebang, so it stays a dynamic import (see [cli-and-skill](cli-and-skill.md));
   - `index` (the library) with `.d.ts` output.
4. `scripts/check-dist-built.mjs`: required files exist (`dist/cli/index.js`, `dist/server/index.js`, `dist/index.js`, `dist/index.d.ts`, `dist/ui/index.html`) and the bin keeps its dynamic import.

Runtime dependencies (hono, commander, zod, croner, env-paths, node-notifier) stay external except that the contract is inlined where imported; `node-notifier` is also listed in `external` explicitly. React and the markdown libraries are devDependencies because Vite bundles them into `dist/ui`.

TypeScript runs as `tsc --noEmit` twice (`typecheck`): the root project (NodeNext, includes `src`, `tests`, `scripts`) and `ui/tsconfig.json` (Bundler resolution, DOM libs). Neither emits; tsup and Vite produce output.

## Package shape

`package.json` `files`: `dist`, `schemas`, `templates`, `src/skill/SKILL.md`, `README.md`, `LICENSE`. `exports` has the single `.` entry (`dist/index.js` and types); `bin` points at `dist/cli/index.js`. The `dist/` layout is:

```
dist/cli/index.js   bin (tiny, Node guard)
dist/cli/main.js    commander program
dist/server/index.js  daemon entry
dist/index.js, index.d.ts   library (contract only)
dist/ui/            static UI served by the server
```

`dist/lifecycle.js` does not exist; lifecycle code is bundled into `cli/main` and `server/index`. `daemon start` therefore passes the server entry explicitly (`<package root>/dist/server/index.js`, found via `packageAssets()`); the `defaultServerEntry()` fallback in `src/lifecycle.ts` assumes `dist/lifecycle.js` and would resolve wrongly from the bundle, so do not rely on it.

## Verification scripts

| Script | Proves |
|--------|--------|
| `scripts/check-dist-built.mjs` | Build output complete, Node guard not bundled away |
| `scripts/verify-tarball.mjs` | `npm pack --dry-run --json` contains the required files, `schemas/*.json`, `templates/**/*.json`, and no stray `src/` (except `SKILL.md`), tests, docs, scripts, or `.worktrees/` |
| `scripts/verify-package-install.mjs` | Behavior of the **real** tarball: pack, install into a scratch project, run the installed bin by path with isolated `CRONTICK_DASHBOARD_HOME` and a non-default port. Checks `--version`, all templates validate, a broken fixture exits 1, `info --json` paths exist, `daemon start`, `/api/health`, `GET /` returns HTML, `new` then `validate` exits 0 with no warnings, the scaffolded card appears in `/api/snapshot`, then stops the daemon and cleans up (including a kill by pid file) |
| `scripts/verify-no-lockfile-tampering.mjs` | Every `package.json` dependency is present in `package-lock.json` |
| `scripts/check-changeset-bumps.mjs` | No pending `major` changeset (ceiling `minor`; `ALLOW_MAJOR=true` or `MAX_BUMP` overrides) |

`npm run validate` chains lint, typecheck, build, test, and `verify-tarball`; `prepublishOnly` reruns it. `verify-package-install` is heavier and separate: CI runs it on the full OS matrix, and it is on the checklist for packaging changes (see [testing](../testing/testing.md)).

## Release

Versioning and changelog belong to changesets (`.changeset/`, `commit: false`, base branch `main`); never hand-edit `CHANGELOG.md` or the version. The manual `Release` workflow (`.github/workflows/release.yml`) first re-verifies (lockfile, build, test, tarball, packed install), then either opens the "Version Packages" PR (`mode: version`) or publishes with npm provenance and pushes tags (`mode: publish`). Nothing publishes on merge. Follow `RELEASING.md` for the steps.

## Dev workflow notes

`ui/vite.config.ts` proxies `/api` to the daemon port, resolved from env `CRONTICK_DASHBOARD_PORT`, then the `daemon.port` file, then the default, so `vite dev` works against a running `daemon start`. The Vite config also hosts the `ui` vitest project (jsdom).
