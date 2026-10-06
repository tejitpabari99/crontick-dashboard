# Contract implementation

Audience: maintainers adding or changing card types or validation.
Non-duplication: the card format is specified in `docs/reference/card-schema.md`; the model is in [card-types](../concepts/card-types.md); rationale in [ADR 0002](../decisions/0002-generic-visual-types-and-card-contract.md). This page covers only how the code is organized.

## Layout

| File | Role |
|------|------|
| `src/contract/envelope.ts` | `envelopeSchema` (zod `looseObject`), `idSchema`, `showSchema` |
| `src/contract/formats.ts` | `timestampSchema`, `cronSchema`, `durationSchema`, `parseDuration`, `windowActive` |
| `src/contract/types/<type>.ts` | `<type>DataSchema` plus `<type>Summary` (notification one-liner) |
| `src/contract/registry.ts` | The single type registry |
| `src/contract/validate.ts` | `validateCardFile`, the only validation entry point |
| `src/contract/index.ts` | Public surface re-exported by `src/index.ts` |
| `src/constants/contract.ts` | `ID_PATTERN`, `MAX_CARD_BYTES` (1 MB), `CLOCK_SKEW_MS` (5 min), `LINK_SCHEMES` |

## Registry

`registry` maps a type name to `{ schema, example, exampleCard, summary, allowedKinds }`. `RegisteredType`, `listTypes()`, `isRegisteredType()`, `getExample()` all derive from it, so adding a type to this one object makes the validator, the CLI `templates` command, the notifier summary, and the schema generator pick it up. Templates in `templates/*.example.json` are imported as JSON modules, so they are embedded at build time and need no filesystem access at runtime.

Adding a type: write `src/contract/types/<t>.ts`, add `templates/<t>.example.json`, register it, run `npm run gen:schemas`, then add the UI folder (see [ui](ui.md)). `tests/contract/templates-schemas.test.ts` fails if a template file and a registered type do not pair up.

## validateCardFile

`validateCardFile(text, { filename?, now? })` never throws and returns either `{ ok, card, warnings }` or `{ broken, reason, message, issues, id? }`. Order of checks, each short-circuiting:

1. Text sanity: U+FFFD or lone surrogate gives `unreadable`; over 1 MB gives `too-large`; strip a BOM; empty or invalid JSON gives `malformed-json`; a non-object top level gives `not-object`.
2. Envelope parse (`schema-invalid`). A well-formed `id` is carried on the failure so the Broken entry can claim the right key.
3. `unknown-type` if the type is not registered.
4. `id-mismatch` if `filename` is given and its stem differs from `id`.
5. Kind check against `allowedKinds` (`schema-invalid`).
6. Per-type `data` parse, skipped when the card declares `error` (agent-declared error cards keep their raw `data`). The parsed value replaces `card.data`, which applies normalizations such as the KPI flat form and the `"complete"` action shorthand.
7. Future `updatedAt` beyond the skew window adds a warning, not a failure.

Issue paths are JSON pointers (`/data/rows/0`); `summarize` builds the one-line message from the first issue.

Unknown keys survive everywhere (loose objects): the write-back path re-serializes the raw JSON, so agent-owned extra fields are never lost. Keys starting `x-` are reserved for agents.

## Schema generation

`scripts/gen-schemas.ts` calls `buildSchemas()` in `scripts/schemas-build.ts`, which converts each zod schema with `z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })` and writes `schemas/{envelope,<type>,card}.json`. Refinements and transforms cannot be expressed in JSON Schema, so each file's `description` carries a hand-written `LOSSY_NOTES` entry naming the rules only the validator enforces. `card.json` composes the envelope with `allOf` if/then blocks keyed on `type`, pointing at `$defs`. The bare-string `action` shorthand is patched back in by `allowActionShorthand`.

The output is committed. CI reruns `npm run gen:schemas` and fails on `git diff --exit-code schemas/`; `tests/contract/templates-schemas.test.ts` validates the templates against the generated files with ajv. Stale files in `schemas/` are deleted by the generator.

## Gotchas

- `src/index.ts` must export only the contract; widening it widens the public API (`tests/contract/type-exports.test.ts` only compile-checks the type exports, nothing guards against additions).
- Contract code runs in the browser build as types only (`ui` imports types from `src/index.js`); keep it free of Node-only imports, since `tsup` bundles it into the library entry.
