# Card types

Audience: agent authors choosing a type, and contributors adding one.
Non-duplication: the exact data fields of each type are owned by `docs/reference/` (card schema) and the generated `schemas/*.json`; the card folder model is in [cards-and-feed](cards-and-feed.md); the decision to use generic types is [ADR 0002](../decisions/0002-generic-visual-types-and-card-contract.md).

## Generic, not per-source

Types describe how data looks, not where it came from. There is no email widget or task widget: an email summary is a `table`, a TickTick list is a `list`. Agents decide the content; the dashboard only needs to know how to draw it. This keeps the component set small and lets one dashboard show anything.

## The v1 set

| Type | Use it for |
|---|---|
| `markdown` | Notes, summaries, free text |
| `table` | Searchable, sortable rows, such as a mail rundown |
| `list` | Items with optional checkboxes, due dates, and links |
| `kpi` | One or several metrics or states, such as deploy status |
| `media` | Images and GIFs with captions and links |

All five types are card types. Alerts are a separate, simpler thing (one-line files in `feed/alerts/`), not a card type.

## Two files, one type

`card.json` picks the type; `data.json` holds the payload for that type. The per-type shapes below describe the payload only (the `data` key of `data.json`); the view fields are the same for every type. An unknown `type` in `card.json` makes the card Broken (`unknown-type`).

## Expandable by design

Contracts require only what rendering needs and allow extra fields. Agents can add columns, item fields, or private data (for example task ids) and the server preserves them untouched. Required fields are strict so mistakes are visible as Broken instead of silently mis-rendered. Links are allowed on rows, items, and cells, and only safe schemes are accepted; every link is clickable.

## The registry model

Every type runs through the same lifecycle: folder, `card.json` validation, `data.json` and type payload validation, state and visibility, snapshot, render inside a uniform card frame (title, fullscreen, Done, hide, Broken, no data yet). Only the pieces that differ per type are per-type modules:

- **Server side:** one contract module per type (a zod data schema, an example template, a one-line notification summary, an example card folder), all registered in a single contract registry. The registry is the only list of type names.
- **UI side:** one folder per type with its renderer, registered in a client registry.

The core never branches on a type name (see [P1](../tech/design-principles.md)). To add a type: add the contract module and its template folder, register it, add the UI renderer, and register that. An unknown type renders as a labeled fallback rather than breaking the page.

## Schemas and templates

zod is the source of truth. JSON Schemas for `card.json`, `data.json`, alerts and each type are generated from it and committed, so a drift check in CI catches stale schemas. Each type ships an example card folder (both files) under `templates/`; agents and the Claude skill point at these. `crontick-dashboard new`, `templates` and `validate` expose them from the CLI.

## Scope limits

No embed or iframe type, no inline video (link to the recording), and local image files are deferred: media accepts web URLs and inline images only. See `docs/agent_files/futures.md` for deferred ideas.
