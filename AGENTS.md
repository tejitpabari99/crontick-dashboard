# AGENTS.md

## Repository purpose

crontick-dashboard is a local, modular personal dashboard for viewing outputs of crontick scheduled jobs (and other widgets). One npm package (Node >= 22.5, ESM): a loopback-only Hono server, a React UI (vite, `ui/`), and a CLI (`crontick-dashboard`). The public library API is exactly the exports of `src/index.ts` (currently the card contract in `src/contract/`); everything else is internal.

## Documentation map

Read the relevant docs before modifying the corresponding area:

| Area | Read first |
|------|-----------|
| Mission and design principles | `docs/tech/` |
| High-level design | `docs/architecture.md` |
| Concepts | `docs/concepts/` |
| Internal module design | `docs/implementation/` |
| CLI / library / contract reference | `docs/reference/` |
| Design decisions and rationale | `docs/decisions/` |
| Testing strategy and layers | `docs/testing/` |
| Full documentation index | `docs/README.md` |
| Planning artifacts (research, brainstorm, PRDs, run records) | `docs/agent_files/` |

Some of these docs may not exist yet; check before relying on them.

## Required commands

```sh
npm ci                       # Install dependencies (clean)
npm run validate             # lint + typecheck + build + test + verify-tarball
npm run lint                 # ESLint
npm run typecheck            # tsc --noEmit for src and ui
npm run build                # gen:schemas + build:ui + tsup + dist check
npm run build:ui             # vite build ui
npm run gen:schemas          # regenerate schemas/ from the zod contract (commit the result)
npm test                     # Vitest run
npm run test:smoke           # build:ui + Playwright smoke (needs `npx playwright install chromium`)
npm run verify-tarball       # shape check of `npm pack --dry-run` (run after build)
npm run verify-package-install  # packs + installs a real tarball, exercises exports and CLI
npm run verify-lockfile      # package.json deps present in package-lock.json
npm run check:changesets     # blocks pending `major` changesets
npm run changeset            # add a changeset
npm run format               # Prettier (write)
```

## Source organization

- `src/contract/` -- card contract: zod types, envelope, formats, registry, validation. Exported via `src/index.ts`.
- `src/feed/` -- feed ingest (card folders `feed/<id>/{card.json,data.json}` and `feed/alerts/*.json`), `read-card-folder` (shared fs reader, also used by the CLI), one recursive watcher plus rescan, events, Done/tick moves. No archive.
- `src/state/` -- state store and warnings.
- `src/compute/` -- pure snapshot computation served to the UI (columns, Now, alerts, Completed list).
- `src/actions/` -- action registry and writeback.
- `src/http/` -- Hono app, guards (Host allowlist, mutation guard), routes, port binding, static UI serving.
- `src/server/` -- server process entry.
- `src/integrations/notify/` -- desktop notification adapter and gate.
- `src/schemas-sync.ts` -- `syncSchemas`: copies packaged schemas to `<data>/schemas/` (called by `new` and server start).
- `src/cli/` -- CLI (`main.ts`, `commands/*` including `new`, `guard.ts`, `io.ts`); `src/lifecycle.ts`, `src/pid.ts`, `src/paths.ts`, `src/config.ts` back `start`/`daemon`/`info`.
- `src/shared/api-types.ts` -- API types shared by server and UI.
- `src/skill/SKILL.md` -- Claude skill shipped in the package.
- `ui/src/` -- React UI: `api/` (client, store), `frame/` (card chrome, chip), `zones/` (header, alert strip, columns and now zone, completed, search), `registry/` (type to renderer), `types/<type>/` (visual types: kpi, list, markdown, media, table), `theme/`, `lib/`.
- `templates/`, `schemas/` -- shipped templates and generated JSON schemas.
- `scripts/` -- build/verify scripts.
- `tests/` -- vitest (cli, contract, integrations, server, skill) and Playwright (`tests/smoke`); UI tests in `ui/tests/`.

## Conventions

1. No new runtime dependencies without explicit approval in the PR description.
2. The server binds loopback only; keep the Host allowlist and mutation guard (`src/http/guards.ts`) intact. No CORS headers.
3. Keep filesystem, clock, and notification side effects behind injectable interfaces (see `src/clock.ts`).
4. Contract changes: update zod types, run `npm run gen:schemas`, commit `schemas/` (CI fails on a diff).
5. Every bug fix adds a regression test; test observable behavior; no order dependence.
6. Prefer Node platform APIs over third-party packages.
7. Public behavior changes: update `README.md`/`docs/reference/`, add a changeset (`npx changeset`), add an ADR in `docs/decisions/` for lasting decisions.
8. Do not hand-edit `CHANGELOG.md` or the version; changesets owns both. Releases are manual, see `RELEASING.md`.

## Definition of done

- [ ] `npm run validate` passes.
- [ ] `npm run test:smoke` passes for UI-affecting changes.
- [ ] Generated schemas committed.
- [ ] Packaged output verified (`npm run verify-package-install`) for packaging changes.
- [ ] Docs current.
- [ ] Changeset added for user-visible changes.
