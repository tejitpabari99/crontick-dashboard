Future ideas, not in v1. Remove an item when it ships.

## Widgets (Glance-inspired, owner tried Glance and liked these)
- **Calendar** — month/agenda view widget.
- **Weather** — small, top-right / in header; location set in card file.
- **RSS / news feed** — headlines list from RSS feeds.
- **More Glance theme presets** — ship several HSL theme presets like Glance's (Dracula, Catppuccin, etc.).

## Visual types cut from v1
- **Embed / iframe** — new card type.
- **Inline video** — in media cards (v1 links to recordings only).
- **History viewer** — browse past versions of a card. Archive is gone, so this needs a new archive design.

## Interaction
- **UI → agent inputs** — type values into a card (e.g. weather location), written back for next agent run.
- **Un-tick alerts from Completed** — move a completed alert back to active.
- **Run / re-run job buttons** — v1 non-goal; revisit only if needed.

## Running & delivery
- **Autostart at login** — launchd (mac) / Task Scheduler (Windows) / systemd user unit (Linux) via `install-service` command; needs more thought.
- **Live updates via SSE** — replace 30–60s polling if watcher alerts feel slow.
- **Push API** — HTTP endpoint for writing cards, alongside feed folder.
- **`write` CLI** — agents write cards via validating CLI command instead of raw files.

## Notifications
- **Web Push** — browser notifications with tab closed (PWA + service worker).
- **Phone push via ntfy** — notify phone anywhere.

## Access & layout
- **Remote access** — expose via ngrok / Tailscale (owner sets up when needed; needs auth).
- **Mobile layout**.

## Layout and model
- **`span`** — card spans 2-3 cards per row.
- **Page-level `dashboard.json`** — dashboard-wide settings file.
- **Multiple pages** — e.g. Work / Personal boards.
- **Configurable column widths**.
- **Shared data files** — several cards reading one data file.
- **Data-optional types** — e.g. calendar; per-type registry flag.
- **YAML input** — accept YAML card/data files.
