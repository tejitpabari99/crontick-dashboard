---
status: approved
summary: Panels become feed/<id>/ folders (card.json view def + data.json content); fixed 3-column Glance layout replaces drag/resize; alerts become single one-line files.
date: 2026-10-07
---

# Brainstorm — card folders and fixed-column layout

Amends the v0.1.0 design in [`../initial-brainstorming/brainstorming.md`](../initial-brainstorming/brainstorming.md) (kept as history). Where they conflict, this brief wins.

## TL;DR

Drag-and-resize is too much for v1. Each panel becomes a folder `feed/<id>/` holding `card.json` (how it renders: type, title, layout, priority, show…) and `data.json` (what the agent rewrites). Layout is declared, not dragged: three fixed columns (fixed-width left/right, flexible center, Glance-style); a card picks `column`, `order`, `height`. Alerts become small single files `feed/alerts/<id>.json` rendered as one-liners. The old single-file `feed/<id>.json` format is dropped.

## Problem

The v0.1.0 grid lets the owner drag and resize, stores positions in `state.json`, and mixes view config with content in one agent-written file. For a first version that is too much mechanism, and it makes layout implicit. The owner wants: layout declared in files, a discrete grid, and a clear split between "how a card looks" (set once) and "what it shows" (rewritten by agents constantly).

## Decision log

| Decision | Alternative rejected | Why |
|---|---|---|
| Panel = folder `<data>/feed/<id>/`; folder name is the id | Single `feed/<id>.json` (v0.1.0) | Separates view definition from agent content |
| Root folder stays named `feed/` | `cards/` | Owner preference; "feed" already is the term |
| `card.json` = view def: `type`, `title`, `data` (relative path, default `data.json`, must stay inside the folder), `layout`, `priority`, `notify`, `show`, `staleAfter` | Everything in one file | View is set once; content changes constantly |
| `data.json` = `{ updatedAt?, priority?, error?, data, x-… }` | Raw body only | Keeps freshness, override and error signalling with content |
| Drop old single-file panel format, no back-compat | Support both | Pre-1.0, PR unmerged, nobody depends on it |
| No drag, no resize; remove layout from `state.json` | Keep drag | Too much for v1; files are the source of truth |
| Three fixed columns: left/right fixed width (~300px), center flexible | Exact 1/6–4/6–1/6 split | 1/6 of 1440px ≈ 240px is too narrow; Glance does fixed sides |
| `layout.column`: `left`/`center`/`right`, default `center` | Free placement | Discrete, no packing algorithm, no overlap |
| `layout.order`: integer ascending, ties by id | Auto-reorder | Stable spatial memory |
| `layout.height`: `S`/`M`/`L`/`auto` (≈180/360/600px; `auto` = content up to L, then scroll), default `auto`; replaces `size` | Only S/M/L | KPI cards would float in empty boxes |
| Engine-applied compact sizes, not owner-settable: **chip** (title only) for Done and low-priority-collapsed cards; **line** (one row) for alerts | Owner-settable `D`/`A` heights | Owner-settable values would be meaningless on normal cards |
| Narrow screen (<~1200px): columns stack center, left, right | Horizontal scroll | Readable on small windows |
| Now zone kept, placed at top of the center column | Full-width strip; drop Now | Prioritisation needed; sides stay still |
| `priority` default in card.json, optional override in data.json | card.json only | Urgency belongs to content, not layout |
| Valid card.json + missing data.json → card shows "No data yet" (muted) in its slot; `staleAfter` still applies | Broken; hidden | Lay out before agents run |
| Missing/invalid card.json → folder ignored with a warning | Broken card | No view def means nothing to render |
| `updatedAt` optional in data.json; fallback to file mtime | Required | Agent writes only content. Cost: no-op rewrite counts as new (can re-notify) |
| Only a new data.json version is "new content" (resets Done, notifies); card.json edits re-render live only | Any change counts | Layout tweaks must not spam notifications |
| No archive: overwritten data.json is not kept; `retention` field and `retentionDefault` config removed | Archive previous data.json versions | Owner: not needed; less mechanism |
| Alerts are single files `feed/alerts/<id>.json`: `title`, `text` (one line, ≤ ~200 chars), `link?`, `priority?`, `notify?`, `show?`, `updatedAt?` (mtime fallback). No type, no layout. Tick moves to `feed/alerts/.done/` | Alerts as folders (earlier pick, reversed by owner) | Alerts are one-liners; two files is heavy; the shape enforces brevity |
| Alert strip stays full width at top, alerts rendered as **line** rows | Alerts in a column | Unmissable |
| Low-priority panels still collapse to a chip until clicked | Drop collapsing | Priority should affect presentation |
| Done panels shrink to a chip in their own slot | Bottom Done tray (v0.1.0) | Keeps spatial memory; matches owner's "shrunk done card" idea. |
| JSON for all files; `new` writes a `$schema` reference into card.json; schemas generated from zod and committed | YAML / XML card.json | Editor autocomplete + validation, no new parser, agents write JSON reliably |
| CLI: `validate <folder>` checks both files (and alert files); new `new <id> --type <t>` scaffolds a folder | Validate only | Prevents two-file mistakes |
| Five visual types and their data schemas unchanged | Redesign types | Out of scope |

## Design

### File layout

```
<data>/feed/
  email-summary/
    card.json      ← view definition (owner / agent once, or `new`)
    data.json      ← content (agent rewrites)
  alerts/
    deploy-failed.json
    .done/         ← ticked alerts
state.json         ← acks, hides, checks, Done (no layout)
```

Card ids keep the existing id rules (lowercase slug, no leading dot), so `alerts` is a reserved id and dot-folders never collide.

### card.json example

```json
{
  "$schema": "<schema ref written by `new`>",
  "title": "Email summary",
  "type": "table",
  "data": "data.json",
  "layout": { "column": "center", "order": 10, "height": "M" },
  "priority": 2,
  "notify": true,
  "show": { "cron": "0 8 * * 1-5" },
  "staleAfter": "2h"
}
```

### data.json example

```json
{ "updatedAt": "2026-10-07T08:00:00Z", "priority": 4, "data": { "columns": ["From", "Subject"], "rows": [] } }
```

### Screen

```
┌──────────────── alert strip (full width, one-line rows) ─────────────┐
├──────────┬────────────────────────────────────────────┬──────────────┤
│ left     │ center (flex)                              │ right        │
│ ~300px   │ [Now zone: active-window, high-priority]   │ ~300px       │
│ [card]   │ [card  height M]                           │ [card]       │
│ [chip]   │ [card  height auto]                        │ [chip]       │
└──────────┴────────────────────────────────────────────┴──────────────┘
```

Server still computes placement as a pure function (cards, state, config, clock) and returns ordered ids per column plus Now and alerts; the UI only draws.

### Parts touched

| Part | Change |
|---|---|
| Contract | Split envelope into card.json schema + data.json schema; add alert schema; `layout` replaces `size`; generated schemas + templates updated |
| Feed/ingest | Watch `feed/*/` folders and `feed/alerts/`; resolve `data` path safely inside folder; mtime fallback; settle-retry per file |
| Compute | Columns + order instead of grid slots; Now at top of center; chip for Done/collapsed; priority override; "No data yet" state |
| State | Drop layout; Done reset only on new data.json version |
| Write-back | `complete` write-back edits data.json; alert tick moves file to `alerts/.done/`; remove archive module, `retention`, `retentionDefault` |
| UI | Three-column layout, heights, chip and line renderings; remove drag/resize |
| CLI / skill | `validate <folder>`, `new`, templates per type as folders; SKILL.md teaches the folder model |
| Docs | ADR 0002 amended, concepts/reference updated; futures.md gains the cut items |

### Failure modes

| Failure | Behaviour |
|---|---|
| card.json missing/invalid | Folder skipped, warning in snapshot |
| data.json missing | "No data yet" card; Broken via `staleAfter` if configured |
| data.json invalid | Broken with reason (as today) |
| `data` path escapes folder | card.json invalid |
| Alert `text` too long / multi-line | Broken alert (schema-invalid) |

## Non-goals

- Drag, resize, or in-browser layout editing.
- `span` (2–3 cards per row), page-level `dashboard.json`, multiple pages, configurable column widths, shared data files between cards (all → futures.md).
- Cards without data (e.g. a calendar type) — future: a per-type "data optional" flag in the registry.
- YAML input.
- Back-compat with the v0.1.0 single-file format.

## Open risks

| Risk | Cheapest test |
|---|---|
| Two files per card is too much friction for agents | Final acceptance: the Claude skill builds the email-summary card from scratch with `new` + one data.json write. If it fails, merge files or improve the skill |
| Fixed ~300px sides too narrow for tables | Render the table template in a side column; fallback is guidance "tables go center" |
| mtime fallback causes re-notify on no-op rewrites | Watch real agent behaviour; skill tells agents to set `updatedAt` when content truly changes |
