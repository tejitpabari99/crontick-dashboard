---
status: approved
summary: Brainstorm brief — local modular dashboard fed by agent-written JSON card files; custom React grid build recommended, pending owner trial of Homarr/Node-RED.
date: 2026-10-05
---

# crontick-dashboard — Brainstorm Brief

## 1. TL;DR

A local, single-user dashboard where scheduled agents (e.g. crontick Claude jobs) drop one JSON file per card into `feed/`. The dashboard renders panels in a draggable/resizable/fullscreen grid plus a persistent alert strip on top. No OSS tool covers interactivity + local files + agent-controlled cards + alerts (see `research-2026-10-05.md`). Recommended build is custom (React + Vite + react-grid-layout + small Node feed server). The card file contract stays tool-agnostic, so the owner's Homarr / Node-RED Dashboard 2 trial can still change the build choice.

## 2. Problem

Outputs of recurring agent jobs (daily email rundown, Wednesday OH meeting notes, PR-status watcher every 30 min, personal tasks with deadlines) are buried in logs. No single place to see them. For: the owner, single user, local machine.

Driving use cases:
- Daily email summary: structured table, searchable/filterable.
- Wednesday office-hours meeting notes, shown Wednesdays from 9am.
- Personal tasks (call X, do taxes) stored in TickTick, added by agents; shown here with due dates; tick here completes in TickTick.
- Session watchers (e.g. PR review status every 30 min) set a flag; alert appears at top.
- Notifications, configurable per card/task.
- Priority ordering (e.g. OH above email; watcher alerts on top).
- Interactive cards: links, images/GIFs, color, inputs (e.g. location), search/filter.
- Later: weather small top-right, more widget types.

## 3. Decision log

| # | Decision | Alternative rejected | Why |
|---|----------|---------------------|-----|
| 1 | One dashboard aggregating everything; source apps (TickTick, mail) stay sources of truth | Separate apps per concern | Single "what needs my attention" surface; no duplication of data ownership |
| 2 | Single user, local, no auth | Auth / multi-user | Exposure handled externally (ngrok etc.) if ever |
| 3 | Separate repo; no crontick integration | Read crontick daemon API | crontick is only the scheduler; agents emit output in dashboard's format |
| 4 | Input = agents write files into watched `feed/` folder, one JSON file per card/alert | Push API; reading crontick output | Any agent can write files; survives restarts; inspectable. Push API maybe later |
| 5 | Card file = data + config in one file (schema in Design) | Separate config + data files | Agent writes exactly one thing |
| 6 | Data can be structured JSON or markdown | Markdown only | Tables/filters need structure |
| 7 | Two kinds: panels (fixed grid) + alerts (top strip) | Whole grid auto-reorders by priority | Self-shuffling grid destroys spatial memory |
| 8 | Alerts persist until ticked; all visible side-by-side, wrapping; sorted priority desc then newest; same `id` rewrite updates in place | Ephemeral/auto-expiring or overriding alerts | Owner requirement: nothing disappears unseen, nothing hides another |
| 9 | Ticking alert moves file to `feed/done/` | Set done flag; delete | Clean feed, keeps history, agents can see it was handled |
| 10 | Time rules in card file: `show.cron` (start) + optional `show.for` (duration); both forms supported; outside window card is hidden | Dashboard-side rules only; raise-but-not-hide | Agent authors the rule; matches "OH on Wednesday only" |
| 11 | Notifications: in-page + browser Notification API while tab open; per-card `notify` flag | Push to phone (ntfy etc.) now | Phone out of scope for now; ntfy addable later without redesign |
| 12 | Cards are interactive but never trigger jobs | Run/re-run buttons | Display + write-back to sources only |
| 13 | TickTick: read + complete only, via official remote MCP server `https://mcp.ticktick.com` (OAuth sign-in once; dashboard server acts as MCP client) | Register TickTick Open API developer app; full task editing in UI; reuse Claude's connector token | No app registration; claude.ai's token is not reusable; editing duplicates TickTick UI; agents add tasks |
| 14 | Fallback if MCP OAuth rejects third-party clients: tick writes intent file, a scheduled Claude job applies it via existing connector (minutes latency) | — | Still no app registration |
| 15 | Failure display: card shows **Broken** + reason, never stale data. Triggers: file `error` field; no update within `staleAfter`; malformed file/schema | Show stale data with "stale" badge | Owner: don't show old data |
| 16 | v1 cuts: multi-page, mobile layout, live push (poll 30-60s instead), themes beyond light/dark, weather (good 2nd-week test widget). Keep drag/resize/fullscreen | Ship all | YAGNI; drag/resize/fullscreen is the core feel |
| 17 | No throwaway prototype; validate by real use alongside crontick | Week-long static prototype | Owner is starting crontick usage now |
| 18 | Build choice: custom build recommended; owner trials Homarr 2.0 and Node-RED Dashboard 2 first | Glance, Dashy, Homepage | Glance/Dashy display-only. Homarr 2.0 (released 2026-10-02) has interactive JSX custom widgets with server-side-auth POST, but: HTTP-only sources, no documented data-driven reorder/visibility, no layout API, notifications widget only shows ntfy/Gotify/Nextcloud history, Docker-first (no Docker on this machine), ~0.6-1 GB RAM |

## 4. Design

### Approaches

| # | Approach | Status | Notes |
|---|----------|--------|-------|
| 1 | Custom build (React + Vite + react-grid-layout + Node feed server) | Recommended | Full control of alert strip, time windows, Broken states |
| 2 | Homarr + small file-serving HTTP bridge | Only if trial passes | Covers TickTick write-back, filterable email table, raising a card; alert strip/time windows/broken states likely still custom |
| 3 | Node-RED Dashboard 2 | Fallback | Full Vue interactivity, flow-editor ergonomics, less home-page feel |

### Card file

```json
{ "id": "oh-notes", "kind": "panel", "type": "markdown",
  "title": "OH notes", "priority": 2, "notify": false,
  "show": { "cron": "0 9 * * 3", "for": "8h" },
  "staleAfter": "8d", "error": null,
  "updatedAt": "2026-10-07T09:05:00-07:00", "data": "# Notes..." }
```

| Field | Meaning |
|-------|---------|
| `id` | Unique, stable; rewrite updates in place |
| `kind` | `panel` or `alert` |
| `type` | Widget type |
| `title` | Card title |
| `priority` | Higher = first |
| `notify` | bool; browser notification on new/changed |
| `show` | Optional `{cron, for}` visibility window |
| `staleAfter` | Optional duration; exceeded = Broken |
| `error` | string or null; non-null = Broken with reason |
| `updatedAt` | ISO timestamp |
| `data` | Shape per widget type |

### Parts

| Part | Responsibility | Depends on |
|------|----------------|-----------|
| `feed/*.json` | Agent-written cards/alerts | none |
| Feed server (Node) | Watch folder, validate schema, compute window visibility + broken state, serve cards, handle alert ticks (move to `feed/done/`), TickTick MCP client | Node, TickTick OAuth |
| Layout file (JSON) | Grid position/size per card id; drag edits persist here | Feed server |
| Alert strip | Side-by-side tiles, sorted, tick to dismiss | Feed server |
| Widget registry | One file per widget type; receives validated `data` + card config, renders inside uniform card frame (title bar, fullscreen, broken state). v1 types: markdown, list, table (search/filter), kpi, embed (iframe/html), tasks (TickTick) | Shared theme tokens |
| Notifications | Browser Notification on new/changed card with `notify: true` | Open tab |

### Data flow

Agent writes file, server watches + validates, page polls every 30-60 s, renders card or Broken. Interaction: page, then server, then file move / TickTick MCP call.

Widget contract goal: an agent can add a new widget type by writing one file + registering it.

### Verification

- Server tests with fixture feed files: valid, broken via `error`, stale, malformed, in-window, out-of-window, alert tick to `done/`.
- One browser smoke check: page loads and renders fixtures.

## 5. Non-goals

- Triggering/running jobs
- Auth
- Mobile layout
- Multiple pages
- Creating/editing TickTick tasks in UI
- Any crontick integration
- Push to phone (v1)

## 6. Open risks

| Risk | Cheapest test |
|------|---------------|
| TickTick MCP may not allow arbitrary OAuth clients (dynamic client registration) | Connect with MCP SDK / MCP inspector to https://mcp.ticktick.com and complete sign-in |
| Owner stops using it | Use alongside crontick for 2 weeks; check if opened daily |
| Homarr trial passes and custom build is wasted | Owner trial happens before any build work |
| Agents write inconsistent card files | Ship JSON Schema + example per widget type; validator returns Broken with reason |
| Polling latency too slow for watcher alerts | Measure; switch to SSE if needed |

## Owner-only tasks

- Trial Homarr 2.0 and Node-RED Dashboard 2.
- TickTick MCP sign-in (once).
- Add git remote.
