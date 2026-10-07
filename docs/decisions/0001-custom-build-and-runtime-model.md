# 0001: Custom build and local runtime model

- Status: Accepted, amended 2026-10-07
- Date: 2026-10-05

## Context

Outputs of recurring agent jobs (daily mail rundowns, meeting notes, PR and deploy watchers) are buried in logs. The owner wants one calm local place to see them, with deep links to the real source (Outlook, recordings), important items surfaced on time, and no missed notification. Kill criteria: no deep links, important items not surfacing, a missed notification, too crowded, not exciting.

Existing dashboards were evaluated: Homarr was reviewed by the owner (too crowded, app-management feel, no way to add local personal output, features like stocks), Dashy is display-only, Node-RED Dashboard 2 was not pursued, and Glance was tried and liked for its look but is too feature-heavy and has no local-file input.

## Decision

Build a small custom dashboard, in its own repository, with no integration into crontick.

- **Input is files.** Agents write one JSON file per card into `<data>/feed/`. Card config and data are one file. *(superseded 2026-10-07, see [ADR 0002 amendment](0002-generic-visual-types-and-card-contract.md#amendment-2026-10-07-card-folders-declared-layout-single-file-alerts))* Any agent can feed it; sources of truth stay where they are.
- **Local, single user.** Binds `127.0.0.1` only, no auth. Exposing it is the owner's infrastructure choice.
- **Small server plus static UI.** A Node server watches the feed, validates, archives *(archive superseded 2026-10-07, see [ADR 0002 amendment](0002-generic-visual-types-and-card-contract.md#amendment-2026-10-07-card-folders-declared-layout-single-file-alerts))*, computes visibility, serves a pure snapshot over HTTP, applies a few fixed mutations, and fires notifications. A React UI polls the snapshot.
- **Server computes, UI draws.** Visibility, Broken, Now, and Done are computed by a pure function on the server so they are testable and identical for every client.
- **Run model.** Started manually by CLI, crontick-style (foreground or `daemon`), one server per data dir; no autostart or service install in v1.
- **Look.** Borrow Glance's HSL theme tokens and narrow-wide-narrow arrangement and a few cheap UX patterns (visited-link colour, relative "updated" time, search shortcut); do not use Glance itself.
- **TickTick.** The dashboard holds no TickTick credentials. `complete` ticks write into the card file and the producing agent completes the task with its own access. This supersedes the earlier plan of an MCP client with OAuth inside the server.
- **v1 cuts.** Multi-page, mobile layout, embed, inline video, history viewer, autostart, UI inputs, phone push.

## Alternatives considered

- Homarr, Glance, Dashy, Node-RED Dashboard 2: rejected as above.
- Push API from agents: files survive restarts and are inspectable.
- Reading crontick's own daemon API: couples the dashboard to one producer.
- Autostart or agent-triggered demand start: deferred; needs more thought.
- A server-side TickTick MCP client: needs OAuth and token handling; the card-file write-back is simpler and keeps credentials out of the dashboard.
- A throwaway prototype: skipped; validate by real daily use instead.

## Consequences

Easier: agents are decoupled and need only write files; state is inspectable and recoverable; the server stays tiny. Harder: no autostart means notifications are missed while the server is down; every needed view must be built as a generic type; the owner maintains the UI. Task completion depends on an agent job running.

## Revisit when

Two weeks of real use fail a kill criterion, a second producer needs push semantics, or missed notifications while the server is down become a real problem (reconsider autostart).

## Amendment 2026-10-07

Three statements above changed; see [ADR 0002's amendment](0002-generic-visual-types-and-card-contract.md#amendment-2026-10-07-card-folders-declared-layout-single-file-alerts) for the decision and rationale: panels are folders (`card.json` + `data.json`), not one file per card; alerts remain single files under `feed/alerts/`; the server no longer archives. The rest of this ADR is unchanged.
