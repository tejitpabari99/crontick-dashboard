---
status: draft
summary: Brainstorm brief v2 — custom-built local dashboard fed by agent-written JSON cards; generic visual types, Now zone, local CLI, cross-platform npm package.
date: 2026-10-05
---

# crontick-dashboard — Brainstorm Brief (v2)

## 1. TL;DR

Local single-user dashboard. Agents (crontick Claude jobs, Claude sessions) write one JSON file per card into a feed folder; dashboard renders them as generic visual types (markdown, table, list, kpi, media) in a drag/resize grid, with a "Now" zone on top for alerts and time-windowed high-priority cards. Custom build (React + Vite + TS + react-grid-layout + small Node server), shipped as npm global package with a crontick-style CLI, runs on 127.0.0.1 on the same machine as the agents (Linux/Windows/macOS). Homarr rejected after owner review. Glance tried and liked: its themes/layout are the visual inspiration, but Glance itself is overkill (too many features) and lacks local file support, so it is not used.

## 2. Problem

Outputs of recurring agent jobs are buried in logs; no single place to see them. User: owner only. Mail = Outlook. Tasks = TickTick.

Use cases:
- Daily email summary: table, searchable/filterable; each row deep-links to the Outlook message.
- Wednesday office-hours (OH) notes + recording link, shown Wednesdays from 9am.
- TickTick personal tasks with due dates; tick here completes in TickTick.
- Session watchers (PR status, deployment complete) raise alerts + notify.
- Weather later (2nd-week widget).

Success: simple, usable, shows the right info; deep links work; important items surface on time and on top per priority; no missed notification; calm, not crowded; exciting enough to open daily.

Kill criteria (owner abandons if):
- Can't go deeper (no deep links to Outlook / recordings).
- Important items don't surface on time / on top per priority.
- Misses a notification (e.g. deployment complete).
- Too crowded / overwhelming.
- Not exciting.

## 3. Decision log

| # | Decision | Alternative rejected | Why |
|---|----------|---------------------|-----|
| 1 | One dashboard aggregating everything; sources (TickTick, Outlook) stay source of truth | Separate apps per concern | One "what needs my attention" surface; no data-ownership duplication |
| 2 | Runs on same machine as agents (Linux VPS or owner's Windows/Mac laptop); binds 127.0.0.1 only, no auth. External exposure (ngrok etc.) = owner's job, out of scope | Tailscale; ngrok OAuth; auth in app | Single user; keeps app trivial; exposure is an infra choice |
| 3 | Separate repo; no crontick integration; crontick only schedules; agents emit dashboard format | Read crontick daemon API | Decoupled; any agent can feed it |
| 4 | Input = agents write one JSON file per card/alert into `<data>/feed/` | Push API; reading crontick output | Survives restarts; inspectable; any agent can write files |
| 5 | Card file = data + config in one file | Separate config + data files | Agent writes exactly one thing |
| 6 | Data = structured JSON or markdown | Markdown only | Tables/filters need structure |
| 7 | Generic, domain-agnostic visual types; each type defines a data contract. New type = template + one component + register, or amend existing. v1: `markdown`, `table` (search/filter/sort), `list` (items, optional checkbox), `kpi` (number or state e.g. deploy ✅/⏳), `media` (images/GIFs + links). TickTick tasks = a `list` card. Cut from v1: `embed`/iframe, inline video (link to recordings) | Domain-specific widgets (email widget, tasks widget) | A table shows emails, docs, anything; fewer components; agents decide content |
| 8 | Any row/item may carry `link` (opens Outlook msg, recording, PR). Checkbox `action` from fixed set: `dismiss`, `ticktick.complete` | Arbitrary actions | Deep links are a kill criterion; fixed actions keep it safe and simple |
| 9 | Per-type templates = JSON Schema + example; required fields strictly validated, additional properties allowed. Invalid → card shows Broken + reason | Strict closed schemas; no validation | Agents can store extras; bad files visible not silent |
| 10 | Agent guidance = Claude skill shipped in package (like crontick `src/skill/SKILL.md`) pointing to templates/examples. CLI `validate` is helper | README only; write-CLI as primary path | Agents learn format where they already look |
| 11 | Two kinds: alerts (top strip) + panels (grid) | Single kind | Alerts must be unmissable |
| 12 | "Now" zone at top: alerts + any panel whose `show` window is active and priority ≥ threshold (config) pinned there during its window, then returns to its grid slot. Rest of grid fixed, no auto-reorder | Whole grid sorted by priority; fixed grid only | Sorting breaks spatial memory; fixed-only means OH notes wouldn't surface |
| 13 | Alerts persist until ticked; side-by-side, wrapping; sorted priority desc then newest; same `id` rewrite updates in place; tick moves file to `feed/done/` | Auto-expiring/overriding alerts; done flag; delete | Nothing disappears unseen, nothing hides another; clean feed, history kept |
| 14 | Panel "Done": button records ack of card's `updatedAt` in `state.json`; card moves to Done tray at bottom as small heading-only chip (click to reopen); returns to normal when agent writes new file (new `updatedAt`) — e.g. OH notes next Wed, email summary tomorrow | Hide completely; dim in place | Declutters but stays recoverable; auto-resets on fresh data |
| 15 | Time rules in card: `show.cron` + optional `show.for`; outside window hidden | Dashboard-side rules only; raise-but-not-hide | Agent authors the rule; matches "OH on Wednesday only" |
| 16 | Notifications: native OS notification fired by server (macOS Notification Center / Windows toast / Linux) for cards with `notify: true` on new/changed, plus in-page highlight. Headless VPS = in-page only | Web Push; ntfy; browser Notification API (v1) | Works with tab closed; no phone infra; ntfy/push addable later |
| 17 | Cards never trigger jobs | Run/re-run buttons | Display + write-back to sources only |
| 18 | TickTick: read + complete only via official remote MCP server https://mcp.ticktick.com (OAuth once; server acts as MCP client). Fallback: tick writes intent file applied by scheduled Claude job | Register Open API app; full editing in UI; reuse Claude connector token | No app registration; claude.ai token not reusable; editing duplicates TickTick; agents add tasks |
| 19 | Broken state: card shows Broken + reason, never stale data. Triggers: `error` field, exceeding `staleAfter`, malformed/invalid file | Stale badge on old data | Owner: don't show old data |
| 20 | Server-side archive: on overwrite, server archives previous version to `<data>/archive/<id>/`; per-card `retention` (e.g. "7d", "15d"), default in config.json. UI shows latest only | Agents manage history; history viewer v1 | Agents just overwrite; history kept cheaply |
| 21 | New card id → auto-placed at first free grid slot; file deleted → card disappears; UI "hide" button stored in `state.json` | Manual placement; hide by deleting file | Zero-config for agents; owner can still declutter |
| 22 | Anti-crowding: per-card `size` hint (S/M/L), compact default, fullscreen for detail; priority ≤ 1 panels collapse to title chip until clicked; no hard cap | Hard card cap | Crowding is a kill criterion; cap would drop info |
| 23 | No UI → agent inputs in v1. UI does only search/filter/sort/tick/done/hide/open link. Card config (e.g. weather location) lives in card file | Input widgets in UI | YAGNI; agent owns config |
| 24 | Global search across all cards (plus per-table search) | Per-table search only | Find anything fast |
| 25 | Light + dark themes. Calm, Linear/Raycast-like, one accent color, good typography, subtle motion on data change; slim header (date, alert count, weather later). Glance-inspired: HSL theme tokens + default narrow–wide–narrow column arrangement on the grid. Owner tried Glance and likes its look | Themes beyond light/dark in v1; using Glance itself | Tokens make swapping cheap; Glance overkill + no local support; borrow look only |
| 26 | Keep drag/resize/fullscreen grid (react-grid-layout); layout persisted in `state.json` | Fixed layout | Core feel; owner wants it |
| 27 | Run model: started manually via CLI, crontick-style (`crontick-dashboard start`, `daemon start|stop|status`, `info` prints feed path + URL, `validate <file>`, `templates`). No autostart/service install in v1 | Autostart at login; agent-triggered demand-start | Autostart needs more thought; keep v1 simple |
| 28 | Packaging: npm global package `crontick-dashboard`, Node ≥22.5, Windows/macOS/Linux. Data dir via `env-paths` with `CRONTICK_DASHBOARD_HOME` override (mirrors crontick `src/paths.ts`). Fixed default port on 127.0.0.1, free-port fallback + port file (like crontick) | Docker; per-OS installers | Matches crontick conventions; no Docker on VPS |
| 29 | Stack: React + Vite + TS + react-grid-layout frontend; small Node server (file watch, validate, compute visibility/broken/Now, serve, ticks, archive, OS notify, TickTick MCP client). Page polls 30-60s (SSE if too slow) | Heavier framework/backend | Small, fits requirements |
| 30 | Build choice: custom build decided. Homarr rejected after owner reviewed repo + demo: too crowded, app-management feel, no way to add local personal output, overkill features (stocks etc.). Node-RED Dashboard 2 not pursued. Glance tried by owner: look liked and borrowed, but overkill (too many features) and no local file support. Dashy display-only (research) | Homarr; Node-RED Dashboard 2; Glance; Dashy | See research doc; owner's own review of Homarr |
| 31 | v1 cuts: multi-page, mobile layout, embed, inline video, history viewer, autostart, UI inputs, push to phone, weather | Ship all | YAGNI; weather = good 2nd-week widget |
| 32 | No throwaway prototype; validate by real use | Week-long static prototype | Owner is starting crontick usage now |

## 4. Design

### Approach

Custom build. File-based contract: agents write cards, server validates + computes state, page renders. Visual types are generic; content comes from agents.

### Card file

```json
{
  "id": "email-summary", "kind": "panel", "type": "table",
  "title": "Email summary", "priority": 2, "notify": false,
  "show": { "cron": "0 7 * * 1-5", "for": "12h" },
  "staleAfter": "26h", "retention": "7d", "size": "L", "error": null,
  "updatedAt": "2026-10-05T07:02:00-07:00",
  "data": {
    "columns": ["From", "Subject", "Action"],
    "rows": [
      { "cells": ["Dana R.", "Q4 budget sign-off", "Reply today"],
        "link": "https://outlook.office.com/mail/deeplink/read/AAMk..." }
    ]
  }
}
```

| Field | Meaning |
|-------|---------|
| `id` | Unique, stable; rewrite updates in place |
| `kind` | `panel` or `alert` |
| `type` | `markdown` / `table` / `list` / `kpi` / `media` |
| `title` | Card title |
| `priority` | Higher = first; ≤1 collapses; ≥ config threshold qualifies for Now |
| `notify` | bool; OS notification + highlight on new/changed |
| `show` | Optional `{cron, for}` visibility window |
| `staleAfter` | Optional duration; exceeded = Broken |
| `retention` | Archive retention for old versions (e.g. "7d"); default in config |
| `size` | S / M / L hint |
| `error` | string or null; non-null = Broken with reason |
| `updatedAt` | ISO timestamp; change resets panel Done |
| `data` | Shape per type; items may carry `link`, `action` (`dismiss` / `ticktick.complete`) |

### Data dir

```
<data>/feed/*.json      agents write here
<data>/feed/done/       ticked alerts
<data>/archive/<id>/    previous versions, per-card retention
<data>/state.json       layout, hidden, done-acks
<data>/config.json      port, defaults (retention, Now threshold, poll interval)
```

Location via `env-paths`: Win `%LOCALAPPDATA%\crontick-dashboard`; mac `~/Library/Application Support/crontick-dashboard`; Linux `~/.local/share/crontick-dashboard`; override `CRONTICK_DASHBOARD_HOME`.

### Parts

| Part | Responsibility | Depends on |
|------|----------------|-----------|
| `feed/*.json` | Agent-written cards/alerts | none |
| Node server | Watch feed, validate, compute visibility/Broken/Now, serve, handle ticks/done/hide, archive, OS notify, TickTick MCP client | Node ≥22.5, TickTick OAuth |
| Type registry | Per type: JSON Schema + example + one React component; rendered in uniform card frame (title, fullscreen, Done, hide, Broken) | Theme tokens |
| Now zone + alert strip | Alerts + active-window high-priority panels, sorted priority desc then newest | Server |
| Grid | react-grid-layout; layout in `state.json`; Done tray at bottom | Server |
| Global search | Filters across all cards | Server data |
| CLI | `start`, `daemon start|stop|status`, `info`, `validate`, `templates` | Server |
| Claude skill | Teaches agents the format; points to templates/examples | Type registry |

### Data flow

Agent writes file → server watches, validates, archives previous version, computes state → page polls 30-60s → renders card / Broken / Now. `notify: true` + new `updatedAt` → server fires OS notification. Interaction: page → server → file move / `state.json` / TickTick MCP call.

### UI layout zones

1. Slim header: date, alert count, global search (weather later).
2. Now zone: alerts + active high-priority panels.
3. Grid: fixed positions, default narrow–wide–narrow columns; drag/resize/fullscreen.
4. Done tray: heading-only chips, click to reopen.

### Visual direction

Calm, Linear/Raycast-like; one accent; good typography; subtle motion on data change; light + dark. Glance findings:
- Theme = HSL tokens: `background-color`, `primary-color` (plus positive/negative), `contrast-multiplier`, `text-saturation-multiplier`; `light: true` flag. Everything else derived from the base so new themes are a few numbers. Borrow as CSS variables (e.g. Dracula: bg `231 15 21`, primary `265 89 79`, contrast 1.2; Catppuccin Latte: light, bg `220 23 95`, primary `220 91 54`).
- Light/dark = same token set with a flag; ship one dark + one light preset.
- Layout = pages of columns, `size: small | full`; typical narrow–wide–narrow. Borrow as default arrangement on our grid (we add drag/resize).
- Feel = dense, flat, low-chrome cards, compact typography. Borrow the density; our compact default + S/M/L.
- Glance is display-only; no alerts/Now/Done. Borrow the look only.
- Owner tried Glance and likes it. Borrow theme/layout inspiration only; Glance itself is overkill and lacks local file support.

### CLI

`crontick-dashboard start` (foreground), `daemon start|stop|status`, `info` (feed path + URL), `validate <file>`, `templates` (list types/examples). No autostart.

### Verification

- Server tests with fixtures: valid, `error`, stale, malformed/schema-invalid, in/out of window, Now promotion, alert tick to `done/`, panel Done ack + reset on new `updatedAt`, archive + retention.
- Notification test on Windows + macOS.
- One browser smoke check: page loads and renders fixtures.
- Real-use validation: daily use for 2 weeks.

## 5. Non-goals

- Triggering jobs
- Auth / network exposure
- Mobile layout
- Multiple pages
- Creating/editing TickTick tasks
- UI → agent inputs
- Crontick integration
- Web Push / phone push
- Autostart
- Embed/iframe
- Inline video
- History viewer

## 6. Open risks

| Risk | Cheapest test |
|------|---------------|
| TickTick MCP may reject third-party OAuth clients | Connect with MCP inspector to https://mcp.ticktick.com, complete sign-in |
| Owner stops using it (kill criteria in §2) | Check daily use over 2 weeks |
| Agents write inconsistent files | JSON Schema + `validate` CLI + Broken state |
| Polling latency for watcher alerts | Measure; switch to SSE |
| Missed notifications while server not started | Accepted for v1; revisit autostart |
| Cross-platform OS notifications flaky | Test node-notifier (or equivalent) on Win + mac early |

## Owner-only tasks

- TickTick MCP sign-in (once).
- Add git remote.
