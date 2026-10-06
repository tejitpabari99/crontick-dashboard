# Library API reference

`import ... from 'crontick-dashboard'`. The public API is exactly the exports of `src/index.ts`: the card contract (`src/contract/`). Everything else (server, CLI internals, feed, state) is private and may change without notice. ESM only, Node >= 22.5; types in `dist/index.d.ts`.

## Functions

| Export | Signature | Notes |
|--------|-----------|-------|
| `validateCardFile` | `(text: string, opts?: ValidateOptions) => ValidationResult` | Never throws. Only validation entry point; the one the server and `validate` use |
| `listTypes` | `() => RegisteredType[]` | `markdown`, `table`, `list`, `kpi`, `media` |
| `getExample` | `(type: string) => unknown` | Cloned example card, `undefined` for unknown type |
| `getExampleFile` | `(type: string) => string \| undefined` | Template file name under `templates/` |
| `parseDuration` | `(value: string) => number` | `30m`, `12h`, `7d`, `2w` to ms; throws on invalid |
| `windowActive` | `(show, now: Date, opts?: { timezone?: string }) => boolean` | Is `now` inside a `show` window; `show` undefined is always active |
| `cellText` | `(cell: Cell) => string \| number \| boolean \| null` | Displayed value of a table cell |

## Values

`registry`: map of type name to `{ schema (zod), example, exampleCard, summary, allowedKinds }`. The single place card types are registered.

## Types

- `ValidateOptions`: `{ filename?: string; now?: Date }`. `filename` enables the id-matches-stem check.
- `ValidationResult`: `{ ok: true; card: Card; warnings: string[] }` or `{ broken: true; reason: BrokenReason; message: string; issues: Issue[]; id?: string }`.
- `BrokenReason`: `unreadable | malformed-json | not-object | too-large | schema-invalid | unknown-type | id-mismatch`.
- `Issue`: `{ path: string (JSON pointer); message: string }`.
- `Card`, `Envelope`, `EnvelopeInput`, `Show`.
- `RegisteredType`, `KnownType` (alias), `CardKind` (`'panel' | 'alert'`).
- Data types: `MarkdownData`, `TableData`, `Cell`, `Column`, `ListData`, `ListItem`, `Action`, `KpiData`, `KpiMetric`, `MediaData`, `MediaItem`.

Field semantics: [card-schema.md](card-schema.md).
