@AGENTS.md

## Claude Code

- Read the relevant `docs/` area (`docs/tech/`, `docs/architecture.md`, `docs/decisions/`) before structural changes.
- Use plan mode for changes to the public API (`src/index.ts`) or the card contract (`src/contract/`).
- Do not modify release workflows (`.github/workflows/release.yml`) unless explicitly requested.
- Prefer `docs/implementation/` for module design over re-reading the full source tree.
- Run `npm run validate` as a single verification step rather than individual checks.
- Planning artifacts live in `docs/agent_files/`; do not treat them as normative docs.
