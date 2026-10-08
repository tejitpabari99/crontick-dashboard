# Notifications implementation

Audience: maintainers changing notification gating, delivery, or summaries.
Non-duplication: when notifications fire and what users see is in [notifications](../concepts/notifications.md); the config key is in `docs/reference/configuration.md`; library choice in [ADR 0004](../decisions/0004-os-notifications-via-node-notifier.md). Constants: `src/constants/notify.ts`.

## Flow

`card:new` and `card:changed` events (already filtered for non-Broken, in-window, changed `updatedAt`; see [feed-and-ingest](feed-and-ingest.md)) reach `createNotifier` in `src/integrations/notify/notifier.ts`. It does no dedupe of its own. For each event: sync the gate warning, drop cards without `notify: true` or when the gate is off, build a payload, pass it through burst control, deliver.

Payload: `title` is the card title; `body` is the registry's per-type summary truncated to 140 characters; `openUrl` is `http://127.0.0.1:<port>/#card=<id>`, built server-side from the bound port.

## Gate

`src/integrations/notify/gate.ts`. `resolveNotifyMode` is pure over `{ platform, env, notifySendOnPath, configValue }`:

- config `off` or `on` wins;
- `auto`: macOS and Windows on; Linux needs `DISPLAY` or `WAYLAND_DISPLAY` and `notify-send` on PATH, else off with a reason (and a warning when only `notify-send` is missing); other platforms off.

`detectNotifySend` walks `PATH` checking an executable file, no shell. `createNotifyGate` re-reads config on every call but probes PATH at most once, and only on a Linux desktop in `auto`. `resolveNotifyGate` is the one-shot variant used by `info` without a server. `notifier.status()` returns `{ enabled, mode, reason }` for `info`. When off, the notifier sets the `notifications` warning (`OS notifications are off: <reason>`), cleared when on, so the owner sees why in the dashboard.

## Burst limiting

State: `windowEnd`, `fired`, `overflow`, `important`, one timer. The first notification opens a 10 s window (`NOTIFY_BURST_WINDOW_MS`). The first 3 (`NOTIFY_BURST_LIMIT`) deliver immediately. Further ones only count; those that are alerts with priority at or above `nowPriorityThreshold` (read live from config) add their title to `important`. When the window ends, by timer or by the next event arriving after expiry, `flushSummary` delivers one summary toast: "N more updates on your dashboard" with body "High priority: a, b" (or a generic line) and a link to `/`. Nothing is silently dropped: `dispose()` flushes pending overflow. The clock and timers are injected.

## Per-type summaries

Each registry entry has a `summary(data)` defensive over unvalidated data: markdown first non-empty line with syntax stripped; list first item text plus "(+N more)"; kpi first metric as value, unit, label; table "N rows"; media first caption else "N images". Add one when adding a type.

## Delivery and failure isolation

`deliver()` wraps the adapter call: sync throws, rejections, and non-promise returns are all caught; failure logs and sets the `notifications-delivery` warning, success clears it. Delivery is never retried and never throws into the event path; `handle()` has its own outer try/catch.

## Adapter

`NotifyAdapter.notify(payload): Promise<void>` (`adapter.ts`) is the only seam. `node-notifier-adapter.ts` wraps node-notifier with `appID: 'Crontick.Dashboard'` and `wait: true`. node-notifier reports errors through its callback, not exceptions, and with `wait: true` the callback can stay open until click or timeout, so the adapter resolves after a 1.5 s grace (`NOTIFY_DELIVERY_GRACE_MS`) if no error arrived. On click (`click`, `activate` events or callback response) it opens the URL once.

Opening is locked down: `isSafeOpenUrl` accepts only `http:` on `127.0.0.1` or `localhost` and rejects whitespace and shell metacharacters; the command is `cmd /c start "" <url>`, `open`, or `xdg-open`, spawned detached with `shell: false`. node-notifier is loaded lazily on first delivery (`startServer` wraps the adapter) and is the one tsup external, so install-time failures do not break startup. `FakeNotifyAdapter` (`fake.ts`) records calls and can throw or reject on demand.

## Not covered

Real toasts on Windows and macOS cannot be unit tested; see the manual checklist in [testing](../testing/testing.md).
