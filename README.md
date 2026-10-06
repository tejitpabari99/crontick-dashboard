# crontick-dashboard

Local dashboard for agent-written cards: scheduled jobs (e.g. crontick runs) or any script drop JSON files into a feed directory, and a local web UI renders them as tables, lists, KPIs, markdown, and media, with alerts and optional OS notifications.

One npm package (Node >= 22.5): a loopback-only server, a React UI, and the `crontick-dashboard` CLI. Version 0.1.0.

## Install

```sh
npm i -g crontick-dashboard      # once published
npm i -g .                       # from a clone (run `npm ci && npm run build` first)
```

## Quick start

```sh
crontick-dashboard daemon start            # or: crontick-dashboard start  (foreground)
crontick-dashboard info                    # URL and feed dir
crontick-dashboard templates markdown      # print an example card
```

Write a card to `<feedDir>/hello.json` (the file name must equal the `id`):

```json
{ "id": "hello", "kind": "panel", "type": "markdown", "title": "Hello",
  "updatedAt": "2026-01-01T00:00:00Z", "data": { "text": "It works." } }
```

Check it with `crontick-dashboard validate <feedDir>/hello.json`, then open the URL from `info` in a browser. Stop with `crontick-dashboard daemon stop`.

Default port: 47616 (falls back to a free port if taken; `info` prints the real URL).

To teach Claude agents to write cards: `crontick-dashboard skill install`.

## Documentation

- [docs/README.md](docs/README.md): full index (concepts, reference, decisions)
- Reference: CLI, configuration, card schema, HTTP API, errors in [docs/reference/](docs/reference/); problems in [docs/troubleshooting.md](docs/troubleshooting.md)
- [AGENTS.md](AGENTS.md): repository guide for coding agents
- [CONTRIBUTING.md](CONTRIBUTING.md): how to contribute
