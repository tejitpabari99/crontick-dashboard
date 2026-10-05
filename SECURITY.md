# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
| < 0.1   | No        |

## Reporting a Vulnerability

Use the GitHub private security advisory feature:

  https://github.com/tejitpabari99/crontick-dashboard/security/advisories/new

Do not open a public issue for security reports. A maintainer will acknowledge receipt within 72 hours and provide an initial assessment within 7 days. Fixes for confirmed issues are best-effort within 30 days.

## Scope

crontick-dashboard is a local tool that renders card files produced by local jobs. The server binds only to loopback (127.0.0.1), rejects requests whose Host is not `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding), sends no CORS headers, and requires a JSON content type plus an `X-Crontick-Dashboard: 1` header on mutating requests.

In scope: any way to make the server listen on a non-loopback address, bypass the Host or mutation guards, reach it from a remote or cross-origin page, or achieve script injection through card content rendered in the UI.

Out of scope: feed files are written by the local user's own jobs and are treated as trusted-local input; vulnerabilities in third-party dependencies should be reported upstream unless crontick-dashboard's usage creates an exploitable path.

## Operational Guidance

- Do not expose the dashboard port through SSH forwarding, reverse proxies, or firewall rules.
- Do not put secrets in cards; card content is stored on disk and shown in the UI.
