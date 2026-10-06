# CLI and skill implementation

Audience: maintainers adding commands or changing skill packaging.
Non-duplication: commands, flags, exit codes, and output formats are in `docs/reference/cli.md`; the lifecycle behind `start` and `daemon` is in [lifecycle](lifecycle.md). Here: how the CLI is wired and kept testable (P4: the CLI is a thin adapter over core modules).

## Two-stage entry

`src/cli/index.ts` is the `bin`. It does one thing: `guardedMain` from `src/cli/guard.ts`. The guard imports only `constants` leaf files (no dependencies), compares `process.versions.node` with `MIN_NODE` (22.5), and on failure prints `error: crontick-dashboard requires Node >=22.5 (found X). Please upgrade Node.` and sets exit code 1. Only after that does it `import('./main.js')`, which pulls in commander, zod, and the rest. Without this split, a static import of a dependency that needs a newer Node would crash with an unreadable stack before the check ran.

The build enforces the split: `tsup.config.ts` builds `cli/index` as its own entry with `./main.js` external, and `scripts/check-dist-built.mjs` fails if the built bin statically imports a heavy dependency or lacks the dynamic `import('./main.js')`. `tests/cli/dist-guard.test.ts` asserts the same on the built bin (skipped when `dist/` is absent).

## run(argv, io)

`src/cli/main.ts` exports `run(argv, io): Promise<number>`. It never calls `process.exit`; `main()` assigns `process.exitCode` so stdio drains. `CliIo` (`io.ts`) abstracts stdout, stderr, stdin, env, and TTY, so tests call `run([...], fakeIo)` in-process and assert output and exit code.

Commands live in `src/cli/commands/<name>.ts`, each exporting `registerX(program, ctx)`; `main.ts` lists them in the `COMMANDS` array. Commands needing collaborators export a `createXRegister(overrides)` factory (`start`, `info`, `skill`); the default instance is what `COMMANDS` uses.

Error handling in `run`:

- commander errors (`exitOverride` is on): help and version exit 0; usage errors print one line and exit 2;
- `CliError(message, exitCode, code?)`: print the message, exit with its code; `--verbose` (or env `CRONTICK_DASHBOARD_VERBOSE`) also prints the `ERROR_CODES` value;
- anything else: `error: <message>`, exit 1, stack with `--verbose`.

Core `AppError`s (codes in `src/constants/error-codes.ts`) are converted to `CliError` at the command boundary, keeping their code. Red output only when stderr is a TTY and `NO_COLOR` is unset.

## Commands, briefly

| Command | Core it calls |
|---------|---------------|
| `validate <file...>` | `validateCardFile` with the file's basename, so `id-mismatch` is caught pre-write; `-` reads stdin; exit 1 if any file is Broken |
| `templates [type]` | `listTypes`, `registry`, packaged `templates/` and `schemas/` paths |
| `info [--json]` | `daemonStatus`, `loadConfig`, `resolveNotifyGate`; works with no server running |
| `start [--port]` | `runForeground`; refuses with the owner's URL if one is healthy; Ctrl+C or `POST /api/shutdown` stops it |
| `daemon start/stop/status` | `daemonStart`, `daemonStop`, `daemonStatus` |
| `skill install [--dir] [--force]` | `installSkill` |

`info --json` field names are a frozen contract because the shipped skill reads them; `InfoJson` in `info.ts` is its type.

## Locating packaged assets

`src/cli/assets.ts` walks up from the running module to the nearest `package.json` whose `name` is `crontick-dashboard`, then derives `schemas/`, `templates/`, and `src/skill/SKILL.md` from that root (`PACKAGE_ROOT_NOT_FOUND` otherwise). This works identically from `src/` under tsx and from `dist/cli/` in an installed package. `resolveUiDir` expects `<entryDir>/../ui` and throws `NOT_BUILT` if `index.html` is absent; `start` passes `<root>/dist/cli` so the lookup lands on `dist/ui`.

## Skill install

`src/skill/install.ts`: copy `src/skill/SKILL.md` to `<skillsDir>/crontick-dashboard/SKILL.md`, default skills dir `~/.claude/skills`. Identical content returns `up-to-date`; differing content throws `SKILL_DIFFERS` unless `--force`. The write is a tmp file in the destination dir plus rename, always a regular file (never a symlink), so an interrupted install cannot leave a truncated skill. The tarball ships `SKILL.md` from `src/skill/` (the only `src/` file allowed by `verify-tarball`). `tests/skill/skill-md.test.ts` guards the skill's content against the CLI it describes; update it together with CLI changes.

## Adding a command

1. Add `src/cli/commands/<name>.ts` with `registerX`; do logic in a core module, not the command.
2. Register it in `COMMANDS`.
3. Convert `AppError` to `CliError`; never `process.exit`.
4. Add a test under `tests/cli/` using fake `CliIo`.
5. Update `docs/reference/cli.md`, the skill if agents need it, and add a changeset.
