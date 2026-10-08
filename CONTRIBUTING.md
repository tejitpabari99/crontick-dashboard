# Contributing to crontick-dashboard

Thank you for your interest in contributing!

## DCO sign-off

All commits must include a `Signed-off-by` trailer (Developer Certificate of Origin):

```
Signed-off-by: Your Name <you@example.com>
```

Add it automatically with `git commit -s`. See <https://developercertificate.org/>.

## Development setup

```sh
node --version   # must be >= 22.5
npm ci
npm run build
npm test
```

UI smoke tests need a browser: `npx playwright install chromium`, then `npm run test:smoke`.

## PR process

1. Fork the repo and create a branch: `git checkout -b feat/my-feature`.
2. Make your changes. Write or update tests.
3. Run `npm run validate` -- must pass. If you changed the card contract, run `npm run gen:schemas` and commit `schemas/`.
4. Open a pull request against `main`.

## Changesets

We use [Changesets](https://github.com/changesets/changesets) for versioning.

- If your PR changes user-facing behaviour, run `npx changeset` and commit the generated file.
- Patch: bug fixes. Minor: new features. Major: breaking changes.
- CI blocks any PR that adds a `major` changeset (`scripts/check-changeset-bumps.mjs`) -- the
  project is pre-1.0, so a major bump jumps straight to `1.0.0` and must be intentional.
- Releases are triggered manually from GitHub Actions. See [`RELEASING.md`](RELEASING.md).

## Code style

- TypeScript strict mode. No `any` casts without a comment explaining why.
- ESLint enforced in CI (`npm run lint`); Prettier available via `npm run format`.

## Commit style

Focused commits, imperative subjects, conventional-commit prefixes: `feat:`, `fix:`, `docs:`, `chore:`.

## Release requirements

- CI green on the supported OS/Node matrix
- Lockfile and tarball verification pass
- Docs updated when behavior changes
