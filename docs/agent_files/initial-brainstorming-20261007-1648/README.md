---
status: draft
summary: Index for the card-folders and fixed-column-layout design — four sub-project PRDs, their dependencies, locked owner decisions and cross-cutting risks.
date: 2026-10-08
---
# Initial brainstorming (2026-10-07 run) — index

Brief: [brainstorm.md](brainstorm.md) (approved, amended 2026-10-08).

## Sub-projects
| NN | Name | PRD | Depends on | Scope |
|---|---|---|---|---|
| 01 | SP01 card-folder-contract | [PRD](01-card-folder-contract/PRD.md) | none | zod schemas for card.json, data.json, alert file; pure folder validator, data-path check, result shapes; generated schemas, folder templates |
| 02 | SP02 feed-and-snapshot | [PRD](02-feed-and-snapshot/PRD.md) | SP01 | folder/alert ingest, shared `readCardFolder`, watcher, column snapshot, Completed lists, state, write-back, notifications, archive removal |
| 03 | SP03 ui-columns | [PRD](03-ui-columns/PRD.md) | SP01 types, SP02 DTO | three-column UI, collapsed chip, alert rows, Completed section, All/Alerts/Cards filter |
| 04 | SP04 cli-skill-docs | [PRD](04-cli-skill-docs/PRD.md) | SP01, SP02 | `new`/`validate`/`templates`, `syncSchemas`, Claude skill, docs sweep, futures, acceptance test |

```
SP01 ──► SP02 ──► SP03
  │        │
  └────────┴────► SP04
```

## Locked decisions (owner, 2026-10-08)
1. `$schema` = relative `../../schemas/<file>`; schemas copied into `<data>/schemas/`.
2. Alert: `title` required, `text` optional (≤200, one line), `link` optional and clickable.
3. `complete` write-back pins `updatedAt` when absent (server side).
4. `data` path = plain file name in the card folder; no subfolders, no symlinks outside.
5. Alerts have own ids: `alert:<id>` in API and saved state.
6. No-data card: `staleAfter` counts from card.json mtime.
7. SP01 provides data-path check and result shapes; SP02 uses them.
8. Server always sets `column`/`height`; `done`/`collapsed` always booleans; no-data cards have no `updatedAt`/`data`; Done card never in Now.
9. One shared `readCardFolder(dir)` in SP02 (`src/feed/`); CLI reuses it.
10. Ingest ignores `.`-prefixed and `*.tmp` files in card folders and `feed/alerts/` (except `feed/alerts/.done/`, read for Completed).
11. Startup no longer creates `archive/`; `new` must not either.
12. SP04 writes `syncSchemas`; server calls it at startup (SP02).
13. Watcher/CI covered by SP02.
14. Narrow screens: DOM order center, left, right; CSS grid areas place wide layout left|center|right.
15. Table scroll hint in a side column: deferred until seen rendered.
16. Broken alert row copy: "Broken alert file: <message>".
17. `validate` checks data.json from stdin (`--as data --type <t>`); skill also runs `validate <folder>` after writing.
18. Completed section (Done cards + ticked alerts, newest first, collapsible) and header filter All/Alerts/Cards; ticked alerts listed 7 days, max 50; no un-tick in v1; reverses the in-slot Done chip.

## Cross-cutting risks
- Two-file friction for agents: tested only by the SP04 final acceptance test (plus owner-run real-Claude check).
- mtime fallback re-notifies on no-op rewrites without explicit `updatedAt`.
- Completed alert list growth bounded by 7 d / 50 in the UI; ticked files stay on disk.

## Run records
- [01-card-folder-contract](01-card-folder-contract/code-2026-10-08-0447.md)
- [02-feed-and-snapshot](02-feed-and-snapshot/code-2026-10-08-0447.md)
- [03-ui-columns](03-ui-columns/code-2026-10-08-0447.md)
- [04-cli-skill-docs](04-cli-skill-docs/code-2026-10-08-0447.md)
