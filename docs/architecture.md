# Architecture

Audience: everyone -- the entry point for understanding how crontick-dashboard's pieces fit together.
Non-duplication: this page is a components-and-links map. Mental models live in `docs/concepts/`, mechanics in `docs/implementation/`, exact lookups (routes, fields, flags, config keys, error codes) in `docs/reference/`, rationale in `docs/decisions/`. Each section links to its one narrative owner instead of restating it.

## Purpose

crontick-dashboard is a local, single-user dashboard for what your agents produced. Agents write one JSON "card" file per card into a feed folder. A small local server validates the cards and computes what is visible, a browser UI renders them with generic visual types, and the server raises OS notifications for cards that ask for it. See [mission](tech/mission.md) for tenets and non-goals.

It ships as one npm package (`crontick-dashboard`): a CLI, the server, the built UI, JSON Schemas, card templates, and a Claude skill.

## Scope and non-goals

Single machine, single user, loopback only, no auth. Not a job runner, not a per-source app (no "email widget"), not an input surface, not an OS service. The full list is in [mission](tech/mission.md).

## Component map

```
 agent / crontick job / CLI-free anything that writes a file
        |  writes <data>/feed/<id>.json
        v
 feed watcher + ingest ----> contract validation ----> card store
 (fs.watch + slow rescan)    (envelope + per-type)          |
        |                                                    v
        +--> archive (previous versions)      state (state.json) + config
        +--> events (new/changed) --> notifier --> OS notification
                                                     |
 compute (pure): cards + state + config + clock ---> snapshot
                                                     |
 HTTP API (Hono, 127.0.0.1) <---- UI polls snapshot, posts mutations
        |
        +--> mutations / actions --> state.json, feed/done/, card write-back
```

| Component | Role | Narrative owner |
|---|---|---|
| Feed directory | The only input. One file per card; agents own these files. | [cards-and-feed](concepts/cards-and-feed.md) |
| Watcher and ingest | Notices new, changed, and removed files; tolerates half-written files; never crashes on bad input. | [cards-and-feed](concepts/cards-and-feed.md) |
| Card contract | zod schemas for the envelope and each type; JSON Schemas are generated from them. One validator shared by server and CLI. | [card-types](concepts/card-types.md), [ADR 0002](decisions/0002-generic-visual-types-and-card-contract.md) |
| Archive | Keeps previous versions of overwritten cards for a retention period. | [cards-and-feed](concepts/cards-and-feed.md) |
| State | Owner decisions that are not card content: layout, hidden, Done acknowledgements, checked items. | [actions-and-state](concepts/actions-and-state.md) |
| Compute | Pure function from cards, state, config, and time to a snapshot: which cards are visible, Broken, in Now, in the grid, in the Done tray. | [zones-and-layout](concepts/zones-and-layout.md) |
| HTTP API | Thin adapter: serves the snapshot, applies a fixed set of mutations, serves the static UI. | [server-lifecycle](concepts/server-lifecycle.md) |
| Actions and write-back | A fixed action set (`dismiss`, `complete`); `complete` edits the card file itself. | [actions-and-state](concepts/actions-and-state.md) |
| Notifier | Turns new or changed cards with `notify: true` into OS notifications behind an adapter interface. | [notifications](concepts/notifications.md), [ADR 0004](decisions/0004-os-notifications-via-node-notifier.md) |
| UI | React single-page app. Polls the snapshot; renders zones, a uniform card frame, and per-type bodies from a client registry. | [zones-and-layout](concepts/zones-and-layout.md), [card-types](concepts/card-types.md) |
| CLI | `start`, `daemon`, `info`, `validate`, `templates`, `skill install`. Adapters over core modules. | [server-lifecycle](concepts/server-lifecycle.md), `docs/reference/cli.md` |
| Claude skill | `SKILL.md` teaching agents the card format; installed by `skill install`. | [ADR 0003](decisions/0003-toolchain-and-distribution.md) |

## Data flow

1. An agent writes (or rewrites) `feed/<id>.json`.
2. The watcher debounces the change, reads the file, and validates it. Invalid files become Broken entries with a reason; they are never dropped silently.
3. The previous version of an overwritten card is archived. New or changed cards emit events.
4. The notifier reacts to events for cards with `notify: true`.
5. The UI polls `GET /api/snapshot` (conditional on a revision tag), so unchanged state costs almost nothing. The snapshot is recomputed from the stores, never cached state.
6. User interactions (tick an alert, mark Done, hide, move a card, tick a list item) are small mutations that update `state.json`, move a file to `feed/done/`, or write back into the card file.

Ownership: agents own card files; the server owns `state.json`, `feed/done/`, and `archive/`; the server edits a card file only for the `complete` write-back.

## Design rules that shape the structure

The binding rules are in [design principles](tech/design-principles.md). Structurally: a fixed lifecycle with per-type modules registered in one registry (P1); CLI and HTTP are thin shims over one core (P4); filesystem, clock, timers, spawn, and notifier are injectable (P5); shared constants and helpers live in `src/constants/` and `src/utils/` (P2, P3).

## Dependency policy

Prefer `node:*` and browser APIs. Runtime dependencies are deliberately few: a small HTTP framework (Hono), a CLI parser (commander), a cron library for `show` windows (croner), an OS-path helper (env-paths), a notification library (node-notifier), and zod for schemas. UI libraries are bundled at build time. A new runtime dependency needs explicit justification. Authoritative list: `package.json` and [P8](tech/design-principles.md).

## Data locations

The data directory is resolved with `env-paths` per platform, overridable with `CRONTICK_DASHBOARD_HOME`.

```
<data>/feed/*.json      cards (agent-written)
<data>/feed/done/       ticked alerts (never deleted)
<data>/archive/<id>/    previous versions
<data>/state.json       layout, hidden, acks, checks, notified
<data>/config.json      owner config (see reference)
<data>/daemon.{pid,port,log,lock}   server process files
```

`crontick-dashboard info` prints the real paths. State is created lazily; restarting loses nothing.

## Build and distribution

Schemas are generated from zod and committed; the UI is built with Vite; the server and CLI are bundled with tsup, and the UI is copied into the package. Requires Node >= 22.5, ESM only. Details: [ADR 0003](decisions/0003-toolchain-and-distribution.md) and `docs/implementation/`.

## Further reading

- Why a custom build: [ADR 0001](decisions/0001-custom-build-and-runtime-model.md)
- Implementation detail: `docs/implementation/` (planned)
- Testing: `docs/testing/` (planned)
