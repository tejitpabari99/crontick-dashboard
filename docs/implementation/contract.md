# Contract implementation

Audience: maintainers adding or changing card types or validation.
Non-duplication: the card format and reason tables are specified in `docs/reference/card-schema.md` and `errors.md`; the model is in [card-types](../concepts/card-types.md); rationale in [ADR 0002](../decisions/0002-generic-visual-types-and-card-contract.md). This page covers only how the code is organized.

## Layout

| File | Role |
|------|------|
| `src/contract/card-def.ts` | `cardDefSchema` (card.json), `layoutSchema`, `showSchema`, `dataPathSchema` |
| `src/contract/data-file.ts` | `dataFileSchema` (data.json envelope: `updatedAt?`, `priority?`, `error?`, `data`) |
| `src/contract/alert.ts` | `alertSchema` (alert files) |
| `src/contract/formats.ts` | `timestampSchema`, `cronSchema`, `durationSchema`, `parseDuration`, `windowActive` |
| `src/contract/types/<type>.ts` | `<type>DataSchema` plus `<type>Summary` (notification one-liner) |
| `src/contract/registry.ts` | The single type registry |
| `src/contract/folder-validate.ts` | `parseCardDef`, `validateCardFolder`, `validateAlertFile`, `isCardFolderName`: the validation entry points |
| `src/contract/index.ts` | Public surface re-exported by `src/index.ts` |
| `src/constants/contract.ts` | `ID_PATTERN`, size caps (`MAX_CARD_BYTES` data file, `MAX_CARD_DEF_BYTES`, `MAX_ALERT_BYTES`), `CLOCK_SKEW_MS`, `LINK_SCHEMES` |

## Registry

`registry` maps a type name to `{ schema, summary, template }`, where `template` is the embedded example `{ card, data }`. `RegisteredType`, `listTypes()`, `isRegisteredType()`, `getExample()` all derive from it, so adding a type to this one object makes the validator, the CLI `templates` and `new` commands, the notifier summary, and the schema generator pick it up. Templates in `templates/<type>/{card,data}.json` are imported as JSON modules, so they are embedded at build time and need no filesystem access at runtime.

Adding a type: write `src/contract/types/<t>.ts`, add `templates/<t>/card.json` and `data.json`, register it, run `npm run gen:schemas`, then add the UI folder (see [ui](ui.md)). `tests/contract/templates-schemas.test.ts` fails if a template and a registered type do not pair up.

## Validation steps

All validators are pure, take text or already-read inputs, and never throw. The fs reading is in `src/feed/read-card-folder.ts` ([feed-and-ingest](feed-and-ingest.md)).

1. `parseCardDef(folderId, cardText)`: id check (`isCardFolderName`; `reserved-id`, `invalid-id`), missing text (`card-def-missing`), size and JSON sanity, `cardDefSchema` parse. Failures are *skipped* results (`card-def-invalid`, or `data-path-invalid` when the issue is on `data`). Success carries the data file name.
2. `validateCardFolder({ folderId, cardText, data })`: runs step 1, then `unknown-type` (Broken), then branches on the data input: absent gives `no-data` (valid), unreadable gives Broken `unreadable`. Otherwise text sanity (`malformed-json`, `not-object`, `too-large`), `dataFileSchema` (`schema-invalid`), and the per-type payload parse unless the data file declares `error`. The effective `updatedAt` is the file's value or the data file mtime (`updatedAtSource`); a future instant beyond the skew window adds a warning, not a failure.
3. `validateAlertFile({ name, text, mtimeMs })`: file name `<id>.json` with a valid id, size cap, `alertSchema`.

Issue paths are JSON pointers (`/data/rows/0`); `summarize` builds the one-line message from the first issue. `staleAfter` and `error` Broken states are added later by the snapshot, not here.

Unknown keys survive everywhere (loose objects): the write-back path re-serializes the raw data file, so agent-owned extra fields are never lost. Keys starting `x-` are reserved for agents.

## Schema generation

`scripts/gen-schemas.ts` calls `buildSchemas()` in `scripts/schemas-build.ts`, which converts each zod schema with `z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })` and writes `schemas/` files: `card-def.json`, `alert.json`, `data.json` (generic envelope), `<type>.json` (bare payload) and `data.<type>.json` (envelope with `data` bound to the payload). Refinements and transforms cannot be expressed in JSON Schema, so each file's `description` carries a hand-written `LOSSY_NOTES` entry naming the rules only the validator enforces. The bare-string `action` shorthand is patched back in by `allowActionShorthand`.

The output is committed. CI reruns `npm run gen:schemas` and fails on `git diff --exit-code schemas/`; `tests/contract/templates-schemas.test.ts` validates the templates against the generated files with ajv. At runtime the files are copied to `<data>/schemas/` by `syncSchemas` (see [cli-and-skill](cli-and-skill.md)). Stale files in `schemas/` are deleted by the generator.

## Gotchas

- `src/index.ts` must export only the contract; widening it widens the public API (`tests/contract/type-exports.test.ts` only compile-checks the type exports, nothing guards against additions).
- Contract code runs in the browser build as types only (`ui` imports types from `src/index.js`); keep it free of Node-only imports, since `tsup` bundles it into the library entry.
