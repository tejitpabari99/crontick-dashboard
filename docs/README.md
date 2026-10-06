# Documentation

All crontick-dashboard documentation, organized by audience and purpose. Use the table to find
what you need or to decide where new content belongs.

---

## Areas

| Area | Answers | Audience |
|------|---------|----------|
| [docs/tech/](tech/) | Guiding docs: mission/tenets and design principles every change is checked against | Contributors and coding agents |
| [docs/architecture.md](architecture.md) | High-level design: how the system fits together | Everyone |
| [docs/concepts/](concepts/) | "How should I think about this?" -- behavior that crosses components | Users and contributors |
| [docs/implementation/](implementation/) | "How is this implemented?" -- private implementation details (planned) | Maintainers and coding agents |
| [docs/reference/](reference/) | "What exactly is supported?" -- precise, lookup-oriented facts (planned) | Users |
| [docs/decisions/](decisions/) | "Why is it like this?" -- architecture decision records | Contributors |
| [docs/testing/](testing/) | How to test and what to verify before a release (planned) | Contributors |
| [docs/agent_files/](agent_files/) | Planning artifacts: brainstorm, PRDs, tasks, reviews, future ideas | Maintainers and coding agents |

---

## Where do I put new documentation?

- **A user-visible fact** (command syntax, config option, card field, error code) -> `docs/reference/`
- **A mental model** (how cards flow, zones, notifications) -> `docs/concepts/`
- **An implementation detail** (watcher internals, storage format) -> `docs/implementation/`
- **A design choice with trade-offs** -> a new ADR in `docs/decisions/` (copy `0000-template.md`)
- **A rule or tenet every change must follow** -> `docs/tech/`
- **A plan, PRD, task list, review, or idea backlog** -> `docs/agent_files/`

Each topic has exactly one narrative owner; other docs link to it. Word budgets
(concepts <= 800, implementation <= 900, architecture <= 2000; reference uncapped) are in
[design principles](tech/design-principles.md) P10.

---

## Rule

Documentation is updated in the same change as the behavior it describes. A PR that changes
observable behavior without updating relevant docs is incomplete.

---

## Full index

### docs/tech/

| File | Description |
|------|-------------|
| [mission.md](tech/mission.md) | Mission, problem statement, tenets, non-goals |
| [design-principles.md](tech/design-principles.md) | Rules every design and implementation must follow |

### docs/ (top-level)

| File | Description |
|------|-------------|
| [architecture.md](architecture.md) | Components-and-links map: feed, ingest, contract, state, API, UI, CLI, notifier |
| [troubleshooting.md](troubleshooting.md) | Common issues and diagnostics (planned) |

### docs/concepts/

| File | Description |
|------|-------------|
| [cards-and-feed.md](concepts/cards-and-feed.md) | Card files, ids, validation and Broken, lifecycle, archive and retention |
| [card-types.md](concepts/card-types.md) | Generic visual types, the registry model, schemas and templates |
| [zones-and-layout.md](concepts/zones-and-layout.md) | Alert strip, Now zone, grid, Done tray, anti-crowding, polling |
| [actions-and-state.md](concepts/actions-and-state.md) | Tick, Done, hide, item actions, write-back, `state.json`, safety |
| [notifications.md](concepts/notifications.md) | When and how OS notifications fire, gating, bursts |
| [server-lifecycle.md](concepts/server-lifecycle.md) | Foreground and daemon modes, process files, port, shutdown |

### docs/implementation/ (planned)

Written next; see the folder once it exists.

### docs/reference/ (planned)

Written next: CLI, card schema, configuration, HTTP API, errors.

### docs/testing/ (planned)

Written next: test layers and pre-release checklist.

### docs/decisions/

| File | Description |
|------|-------------|
| [README.md](decisions/README.md) | ADR index and process |
| [0000-template.md](decisions/0000-template.md) | Template for new ADRs |
| [0001](decisions/0001-custom-build-and-runtime-model.md) | Custom build and local runtime model |
| [0002](decisions/0002-generic-visual-types-and-card-contract.md) | Generic visual types and a validated card contract |
| [0003](decisions/0003-toolchain-and-distribution.md) | Toolchain and distribution |
| [0004](decisions/0004-os-notifications-via-node-notifier.md) | OS notifications via node-notifier (Proposed) |

### docs/agent_files/

Planning artifacts, not user documentation. Start at
[initial-brainstorming/README.md](agent_files/initial-brainstorming/README.md) (brainstorm, six
sub-project PRDs and tasks, reviews, implementation run) and
[futures.md](agent_files/futures.md) (deferred ideas).
