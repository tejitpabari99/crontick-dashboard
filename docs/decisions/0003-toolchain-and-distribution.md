# 0003: Toolchain and distribution

- Status: Accepted
- Date: 2026-10-05

## Context

crontick-dashboard runs on the same machine as the agents (Linux VPS, Windows or macOS laptop) and should install the same way as its sibling crontick.

## Decision

- **One npm package** `crontick-dashboard`, ESM-only, Node >= 22.5, containing the CLI, server, built UI, generated schemas, templates, and the Claude skill. Global install or `npx`.
- **TypeScript everywhere.** Server and CLI built with tsup; UI is React plus Vite, with react-grid-layout for the grid; vitest for tests; Playwright for one smoke path.
- **Build order:** generate schemas, build the UI, bundle the server, copy the UI into the package.
- **Few runtime dependencies,** platform APIs preferred (see [P8](../tech/design-principles.md)): Hono, commander, croner (cron windows), env-paths, node-notifier, zod. UI libraries are bundled at build time.
- **Data location** via `env-paths` with a `CRONTICK_DASHBOARD_HOME` override; a fixed default port on loopback with free-port fallback.
- **CLI** mirrors crontick conventions: `start`, `daemon start|stop|status`, `info`, `validate`, `templates`, and `skill install`. `info` works with the server stopped.
- **Releases** use changesets and CI verification of the packed tarball.

## Alternatives considered

- Docker: unnecessary on a VPS; bad fit for a desktop notification path.
- Per-OS installers: more to maintain than one npm package.
- A different language or framework: no benefit; TypeScript matches crontick and gives shared types between server and UI.
- Installing the skill automatically: skill install is an explicit owner command, not a side effect of package install.

## Consequences

Easier: one install path, shared conventions with crontick, shared types across the boundary. Harder: Node >= 22.5 is required; the UI must be built before the package is complete.

## Revisit when

Node requirements change, or a non-Node install path is needed.
