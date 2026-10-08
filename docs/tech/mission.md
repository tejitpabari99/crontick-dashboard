# Mission & Tenets

> This is crontick-dashboard's guiding spirit — the standard design decisions get checked against. It is a **living doc**: when reality moves, update it here, not just in code.

## Mission

crontick-dashboard is one calm, local place to see what your agents produced. Agents (crontick jobs, Claude sessions, anything that can write a file) drop JSON "cards" into a feed folder; a small local server validates them and a browser UI renders them with generic visual types, surfacing what matters now and notifying you when it needs you.

## Problem it solves

Outputs of recurring agent jobs (daily mail rundowns, meeting notes, PR/deploy watchers) end up buried in logs. There is no single surface for "what needs my attention". crontick-dashboard is that surface: agents emit a card, the dashboard shows it, deep-links to the real source, and raises the important ones on time and on top. Sources of truth (Outlook, TickTick) stay where they are.

## Tenets

| # | Tenet | What this means in practice | Status |
|---|-------|------------------------------|--------|
| 1 | **Local-first & private** | No cloud service, single user. The server binds 127.0.0.1 only, no auth; exposing it is the owner's infra choice. All state (feed, `state.json`, `config.json`) is plain files in the data dir. | Implemented |
| 2 | **Agent-writable** | Any agent feeds the dashboard by writing a small card folder (`card.json` plus `data.json`) into `<data>/feed/`; `crontick-dashboard new` scaffolds it. No SDK, no push API, no coupling to crontick. A shipped Claude skill and per-type templates teach agents the format. | Implemented |
| 3 | **Generic visual types** | Domain-agnostic types (`markdown`, `table`, `list`, `kpi`, `media`) each with a data contract; agents decide content. No per-source widgets (no "email widget"). A new type is one contract module plus one UI renderer, registered. | Implemented |
| 4 | **Contract-validated, never silent** | Cards are validated against the zod card contract (JSON Schemas generated from it). Required fields are strict, extras allowed. Invalid, errored, or stale cards render as Broken with a reason, never stale data. | Implemented |
| 5 | **Calm & surfacing the right thing** | Alerts and active-window high-priority cards surface in the Now zone; the rest of the three-column layout stays spatially stable. Compact by default, declared heights, collapse for low priority, no auto-reorder. Crowding is a failure. | Implemented |
| 6 | **Safe by default** | Loopback-only bind, host and header guards on mutations. Write-back actions come from a fixed set (`dismiss`, `complete`; `complete` edits the card file's checked state, no TickTick call), never arbitrary. Cards never trigger jobs. Unsafe links/images are rejected. | Partial: guards and fixed actions in place; TickTick sync planned, not implemented |
| 7 | **Notifies reliably** | Cards with `notify: true` raise a native OS notification from the server (tab open or not), plus an in-page highlight. Headless hosts degrade to in-page only. | Implemented (OS delivery varies by platform) |
| 8 | **Lightweight** | One small Node process and a static UI. Event-driven file watching (with a slow safety rescan), few runtime dependencies, minimal UI polling. | Implemented |
| 9 | **Recoverable & inspectable** | Everything is files: card folders, alert files, `state.json` hidden/done. Restart loses nothing; ticked alerts move to `feed/alerts/.done/`, never deleted. | Implemented |
| 10 | **Cross-platform** | Linux, macOS, Windows; Node >= 22.5; one npm package with CLI, server, and UI. | Implemented (notifications tested per platform) |

### Proposed additional tenets — owner to confirm

| # | Tenet | What this means in practice |
|---|-------|------------------------------|
| 11 | **Source stays truth** | The dashboard displays and writes back only minimal actions (tick); it never becomes the editor of TickTick/Outlook data. |

## Non-goals

- Not a job runner — cards never trigger or re-run jobs.
- Not multi-user or network-exposed — no auth, no remote listener.
- Not a per-source app — no domain widgets; no editing TickTick/Outlook content.
- Not an input surface — no UI forms feeding agents; card config lives in `card.json`.
- Not a general widget platform — no embed/iframe, inline video, history viewer, multi-page, mobile layout, or phone push in v1.
- Not an OS service — no autostart or service install.

## How to use this doc

When a design or implementation decision conflicts with a tenet, don't quietly proceed: either change the design to fit the tenet, or update the tenet explicitly here, with an ADR in `docs/decisions/` explaining why. Silence is not agreement — an unresolved conflict between a change and a tenet is a signal to stop and reconcile the two, not to ship around it.
