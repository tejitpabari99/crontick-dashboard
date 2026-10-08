# 0004: OS notifications via node-notifier

- Status: Proposed
- Date: 2026-10-05

## Context

A missed notification (such as "deployment complete") is a kill criterion, so notifications must work with the browser tab closed. That requires the server, not the page, to raise native OS notifications on Linux, macOS, and Windows. Web Push, ntfy, and the browser Notification API were considered for v1.

## Decision

- The server fires native notifications for cards with `notify: true` on a new or changed `updatedAt`, plus an in-page highlight. Headless hosts degrade to in-page only.
- Delivery goes through a `NotifyAdapter` interface. `node-notifier` is the default adapter, provisional. A shell-out adapter (`osascript`, PowerShell toast, `notify-send`) is the fallback if it fails real-machine testing.
- A gate decides once whether delivery is on: `notifications.os` is `auto`, `on`, or `off`, and `auto` checks platform, display, and `notify-send`.
- Delivery failures are isolated and surface as warnings, never breaking ingestion.

Status is Proposed because only Linux has been verified (load on Node 22, errors arrive through callbacks rather than exceptions). Real Windows and macOS runs (toast shown, click-through, permission prompts, Focus Assist) are owner-pending; results are tracked in `docs/agent_files/initial-brainstorming/05-notifications/spike-notes.md`.

## Alternatives considered

- Browser Notification API: needs the tab open.
- Web Push, ntfy: phone infrastructure out of scope for v1; can be added later behind the same adapter.
- Hand-rolled per-OS shell-outs as the primary path: more code to maintain; kept as the fallback.

## Consequences

Easier: swapping or adding delivery channels; testing with a fake adapter. Harder: `node-notifier` is CJS-only, last released 2022, with open issues (outdated bundled macOS helper, a low-risk transitive advisory); cross-platform behavior may differ.

## Revisit when

The owner's Windows and macOS runs fail or show unreliable delivery (switch to the fallback adapter), or the library becomes unmaintained. On success, set Status to Accepted.
