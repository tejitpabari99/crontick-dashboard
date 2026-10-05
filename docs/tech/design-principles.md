# Design Principles

Rules every design and implementation in crontick-dashboard must follow. This is a **living doc** — reviewers check PRs against it, and it should be updated (with an ADR where it's a lasting decision) whenever a real change forces a rule to move.

## 1. Common card-type framework, per-type modules

Every card type (`markdown`, `table`, `list`, `kpi`, `media`, ...) has its own data shape and renderer, but the *lifecycle* is identical: file → envelope validation → type data validation → state/visibility → snapshot → render in the uniform card frame.

**Rationale:** if the core branches on type name, every new type is a core change and a source of drift. A fixed pipeline with registered per-type modules keeps the core stable as types are added.

Server side, `src/contract/registry.ts` is the single registry; each type is one module in `src/contract/types/<type>.ts` (zod data schema) plus its template. UI side, each type is one folder `ui/src/types/<type>/` registered via `registerCardType` in `ui/src/registry/registry.ts`. Everything type-specific (schema, example, search text, notification summary, rendering) hangs off those registered modules.

- **Do** add a type by adding one contract module + template, registering it, and adding one UI renderer registered.
- **Do** expose type-specific behaviour (search text, summary) as a field on the registered module.
- **Don't** write `if (card.type === 'table')` / `switch (type)` in the core, server, frame, zones, or notifier.
- **Don't** let one type's needs leak into the shared `CardTypeDef` / `TypeEntry` shape other types must implement.

## 2. Work modular

Anything that can be a standalone, reusable function should be one.

**Rationale:** modular helpers are independently testable and stop the same logic getting reimplemented (and re-diverging) in two places.

Shared helpers live in `src/utils/` (server/CLI/contract) and `ui/src/lib/` (UI) — one concern per file, pure where possible, unit-tested. Cross-boundary API types live in `src/shared/`; type-local helpers stay inside their `ui/src/types/<type>/` folder (`logic.ts`, `shared/`).

- **Do** extract a helper as soon as a second call site needs the same logic.
- **Do** keep each utils file scoped to one concern (durations, time formatting, path resolution) rather than a catch-all `helpers.ts`.
- **Don't** copy-paste logic across modules "just this once."
- **Don't** put business logic in a util — utils are pure support, not decision-makers.

## 3. Constants in one place

All constants — especially anything used in more than one file, including tests — plus default config values live in `src/constants/` (server/CLI/contract), grouped by domain (e.g. `src/constants/feed.ts`, `src/constants/http.ts`, `src/constants/notify.ts`), and `ui/src/constants/` for the UI (polling, grid, storage keys).

**Rationale:** a magic number duplicated between source and test can drift silently; a test that imports the same constant as the source it tests can't drift from it.

- **Do** add a new domain file under the constants dir when an existing one doesn't fit.
- **Do** have tests import the constant, not re-declare its value.
- **Don't** inline a literal (timeout, retry count, default port, limit, storage key) that appears, or is likely to appear, in more than one file.
- **Don't** declare `export const FOO_MS` at the top of a feature file for others to import.

## 4. Single core, thin shims

CLI commands (`src/cli/`) and HTTP routes (`src/http/`) are adapters over core modules (`src/contract`, `src/compute`, `src/feed`, `src/state`, `src/actions`). They parse transport input, call one core function, and format the result. Validation, visibility/Now computation, and orchestration live in the core, so `crontick-dashboard validate` and the server accept exactly the same cards.

- **Do** put validation, error construction, and orchestration in core modules.
- **Don't** add a CLI-only or HTTP-only branch of logic that the other surface doesn't get.

## 5. Side effects behind injectable interfaces

Filesystem, timing (clock/timers), process spawning, and OS notifications are accessed through injectable interfaces (e.g. `Clock`, `Timers`, `NotifyAdapter`, `CliIo`), never called as bare globals from business logic.

- **Do** accept a `clock`/`timers`/`fs`/`spawn`/`notifier`-like dependency with a real default, so tests can substitute a fake (`fakeClock`, notify `fake`).
- **Don't** call `child_process.spawn`, `Date.now()`, `new Date()`, `setInterval`, or `fs.*` directly from deep inside logic a test would otherwise need to run for real.

## 6. No dead code, no legacy paths

Pre-1.0, a removed feature is removed, not deprecated-and-kept. A capability that's gone is guarded by a regression test proving it stays gone.

- **Do** delete the old code path in the same change that removes the feature.
- **Don't** leave a flag, branch, or config option "just in case" once its feature is gone — reintroducing a removed feature requires explicit sign-off explaining why the original removal rationale no longer applies.

## 7. Actionable errors

Every error surfaced to a consumer is a typed error with a machine-readable `code` and a message that tells the user what to do, not just what went wrong. CLI failures use `CliError` (message + exit code); HTTP errors return `{ error, code }` with a proper status; card problems surface as Broken with a reason naming the fix.

- **Do** give a new failure mode its own code and a message that names the fix (e.g. "run `crontick-dashboard info`").
- **Don't** surface a raw `Error`, a stack trace, or a message that only restates the failure with no next step.

## 8. Platform APIs over dependencies

Prefer `node:*` built-ins and browser APIs over third-party packages. Current runtime dependencies are `hono`, `@hono/node-server`, `commander`, `croner`, `env-paths`, `node-notifier`, `zod`; UI libraries (`react`, `react-grid-layout`, `react-markdown`, `remark-gfm`) are bundled at build time. A new runtime dependency needs explicit justification and review.

- **Do** check for a built-in (`node:fs`, `node:crypto`, `node:util`, `fetch`, `structuredClone`) before reaching for a package.
- **Don't** add a dependency to save a few lines of code that a platform API already covers.

## 9. Lightweight by construction

Ties to Tenet 8 in `mission.md`: the server and UI stay cheap by design, not by later optimization. The feed is watched with `fs.watch` (debounced) plus a slow safety rescan; UI polling is infrequent, backs off when the tab is hidden or the server is down, and may move to SSE.

- **Do** default to event-driven mechanisms (`fs.watch`, timers, `EventEmitter`) over polling.
- **Don't** add a loop that wakes up "just to check" when an event or scheduled callback would do, or pause-less UI timers that run while the tab is hidden.

## 10. Documentation word budgets and topic ownership

Each doc area has a word budget and exactly one narrative owner per topic; other docs link to the owner instead of repeating it.

- `docs/concepts/*.md`: ≤800 words each.
- `docs/implementation/*.md`: ≤900 words each.
- `docs/reference/*.md`: uncapped (exact lookups belong here, however long).
- `docs/architecture.md`: ≤2000 words -- a components-and-links map, not a restatement of `docs/implementation/`, `docs/concepts/`, or `docs/reference/`.
- `docs/decisions/`: ADRs, one decision each.

**Do** open every doc in `concepts/`, `implementation/`, and `architecture.md` with a one-line audience statement and a non-duplication note naming the doc that owns any topic it would otherwise repeat.

**Do** move a lookup-style table (full route list, card field list, config keys, error codes) to the relevant `docs/reference/` file rather than keeping two copies in sync by hand.

**Don't** restate another layer's narrative to pad a doc back up to a round number, and don't let a doc grow past its budget without moving detail to its owning layer first.

## Changing these principles

Edit this file directly, and add an ADR in `docs/decisions/` when the change reflects a lasting design decision (not just a wording fix).
