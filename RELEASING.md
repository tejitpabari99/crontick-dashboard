# Releasing crontick-dashboard

## Preflight

```sh
npm ci
npm run validate
npm run verify-lockfile
npm run verify-package-install
```

`prepublishOnly` reruns `npm run validate` during publish.

## Create a changeset

For user-facing changes:

```sh
npx changeset
```

Commit the generated markdown file under `.changeset/`. The initial `0.1.0` version is set directly in `package.json`; later releases are computed from changesets.

## Release flow (manual only)

Nothing publishes automatically on merge to `main`.

1. **Actions -> Release -> Run workflow**, choose a `mode`:
   - **`version`** -- runs `changeset version` and opens/updates the "Version Packages" PR against `main` (bumps version, writes `CHANGELOG.md`, consumes changesets). Does not publish.
   - **`publish`** -- publishes the version already on `main` to npm (with provenance) and pushes the git tag. Run after merging the Version Packages PR.
2. Both modes run behind a `verify-package` job (lockfile, build, tests, tarball, packed install). The `release` job only starts if it passes.

Requires the `NPM_TOKEN` repository secret.

For the very first publish (`0.1.0`, no changesets pending), run `publish` mode directly; `changeset publish` publishes any version not yet on npm.

## Major-bump guard

`npm run check:changesets` fails if any pending changeset declares `major` (pre-1.0, it would jump to `1.0.0`). Tick the `allow_major` workflow input (`ALLOW_MAJOR=true`) to override. `MAX_BUMP=patch|minor|major` sets an explicit ceiling and takes precedence.

## Exact version control

- Edit a changeset's bump in its frontmatter before running `version` mode, or
- run `npx changeset version` locally and hand-edit, or `npm version <x.y.z> --no-git-tag-version`, or
- use pre-release mode: `npx changeset pre enter <tag>` / `npx changeset pre exit`.

## Tarball verification

`npm run verify-tarball` checks the packed artifact has the built CLI, server, library, UI (`dist/ui`), `src/skill/SKILL.md`, schemas, templates, README and LICENSE, and no test files.
