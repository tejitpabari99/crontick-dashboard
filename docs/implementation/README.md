# Implementation

Audience: maintainers and coding agents changing crontick-dashboard internals.
Non-duplication: this folder explains how the code works. Mental models live in [concepts](../concepts/), the component map in [architecture](../architecture.md), exact lookups (flags, routes, fields, codes, config keys) in `docs/reference/`, rationale in [decisions](../decisions/). Everything here is internal and may change without a major version bump; the only public API is `src/index.ts`.

## Reading order

1. [architecture](../architecture.md) for the component map.
2. [contract](contract.md): the one validator everything shares.
3. [feed-and-ingest](feed-and-ingest.md) then [state](state.md): how cards and owner decisions get into memory and onto disk.
4. [http-server](http-server.md) and [lifecycle](lifecycle.md): serving and process control.
5. [notifications](notifications.md), [cli-and-skill](cli-and-skill.md), [ui](ui.md).
6. [build-and-package](build-and-package.md) for toolchain and release checks.

| Doc | Covers |
|-----|--------|
| [contract.md](contract.md) | zod schemas, type registry, folder and alert validators, schema generation |
| [feed-and-ingest.md](feed-and-ingest.md) | folder reader, watcher, ingest settle, events, alert tick (`feed/alerts/.done/`) |
| [state.md](state.md) | `state.json` store, atomic writes, reconcile and pruning, config reader |
| [http-server.md](http-server.md) | Hono app, guards, routes, snapshot ETag, static, errors, write-back |
| [lifecycle.md](lifecycle.md) | `startServer` wiring, pid/port/lock files, daemon start and stop |
| [notifications.md](notifications.md) | gate, notifier, burst limiting, node-notifier adapter |
| [cli-and-skill.md](cli-and-skill.md) | commander wiring, Node guard, `new`, `validate` stdin modes, schema sync, skill install |
| [ui.md](ui.md) | polling store, mutations, renderer registry, columns, Completed, search, theme |
| [build-and-package.md](build-and-package.md) | tsup, vite, dist checks, tarball verification, release |

## Source layout

| Path | Role |
|------|------|
| `src/contract/` | `card-def.ts`, `data-file.ts`, `alert.ts`, per-type schemas, `registry.ts`, `folder-validate.ts`, `formats.ts`. Exported via `src/index.ts`. |
| `src/feed/` | `read-card-folder.ts` (shared fs reader), `ingest.ts` (card, alert and completed-alert stores), `watcher.ts` (recursive fs.watch), `events.ts`, `done.ts` (alert tick). |
| `src/state/` | `store.ts` (`state.json`), `warnings.ts` (keyed warning registry). |
| `src/compute/` | `snapshot.ts`: pure cards + alerts + state + config + clock to snapshot (columns, Now, alerts, Completed). |
| `src/actions/` | `registry.ts` (`dismiss`, `complete`), `writeback.ts`, `lookup.ts`. |
| `src/http/` | `app.ts`, `guards.ts`, `mutations.ts`, `actions.ts`, `static.ts`, `errors.ts`, `bind-port.ts`, `server.ts` (`startServer`). |
| `src/server/` | `index.ts`: detached server process entry. |
| `src/integrations/notify/` | `gate.ts`, `notifier.ts`, `adapter.ts`, `node-notifier-adapter.ts`, `fake.ts`. |
| `src/cli/` | `index.ts` (bin), `guard.ts`, `main.ts`, `io.ts`, `assets.ts`, `commands/*`. |
| `src/schemas-sync.ts` | `syncSchemas`: copies packaged schemas to `<data>/schemas/` (called by `new` and server start). |
| `src/skill/` | `SKILL.md` and `install.ts`. |
| `src/shared/` | `api-types.ts`: snapshot types shared by server and UI. |
| `src/constants/` | Every tunable and wire constant, one file per concern (P2). |
| `src/utils/` | `errors.ts` (`AppError`), `retry.ts`, `timers.ts`, `sleep.ts`, `port.ts`, `loopback.ts`, `guards.ts`, `text.ts`, `markdown.ts` (P3). |
| `src/*.ts` | `lifecycle.ts`, `pid.ts`, `paths.ts`, `config.ts`, `clock.ts`, `instant.ts`. |
| `ui/src/api/` | Snapshot store, client, mutations, toasts. |
| `ui/src/registry/` | `registerCardType`, `getCardType`, unknown-type fallback. |
| `ui/src/types/<type>/` | One folder per visual type; `types/index.ts` is the import hub. |
| `ui/src/zones/` | Header, alert strip, Columns and Now zone, Completed section, search box, hidden popover, server-down page. |
| `ui/src/frame/` | Uniform card chrome, error boundary, fullscreen. |
| `ui/src/lib/`, `theme/`, `constants/`, `types` | Pure helpers (filter, search, hash, theme, relative time), CSS tokens, UI constants. |

## Cross-cutting patterns

- **Injection (P5).** Clock (`src/clock.ts`), timers (`src/utils/timers.ts`), sleep, rename, spawn, and the notify adapter are passed in; defaults are real. Tests inject fakes (see [testing](../testing/testing.md)).
- **Errors.** Server and CLI code throws `AppError` with a code from `src/constants/error-codes.ts`; HTTP renders `{ error, code }`, the CLI wraps it in `CliError`.
- **Instants.** Compare timestamps with `sameInstant` (`src/instant.ts`), never string equality.
- **Never crash on input.** Bad card, config, or state files become warnings or Broken entries, not exceptions.
