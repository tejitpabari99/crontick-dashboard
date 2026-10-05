Follow the repository conventions and validation requirements in `AGENTS.md`.

Before proposing a change:

- Identify whether the public API (`src/index.ts` exports) or the card contract (`src/contract/`, `schemas/`) is affected.
- If the contract changes, regenerate schemas with `npm run gen:schemas` and commit `schemas/` (CI diffs it).
- Read the relevant `docs/` area (`docs/tech/`, `docs/architecture.md`, `docs/concepts/`, `docs/decisions/`) for prior rationale.
- Run `npm run validate` to confirm lint, typecheck, build, tests, and tarball checks pass; run `npm run test:smoke` for UI changes.
- If the change is user-visible, update `README.md`/`docs/reference/` and add a changeset (`npx changeset`).
