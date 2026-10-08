# Library API reference

`import ... from 'crontick-dashboard'`. The public API is exactly the exports of `src/index.ts`, which re-exports `src/contract/index.ts`: the card contract. Everything else (server, CLI internals, feed, state) is private and may change without notice. ESM only, Node >= 22.5; types in `dist/index.d.ts`. There is no filesystem access here: validators take text and file times, and the caller (server, CLI) does the reading.

## Functions

| Export | Signature | Notes |
|--------|-----------|-------|
| `parseCardDef` | `(folderId: string, cardText: string \| null) => DefResult` | Step 1: validates `card.json` text and the folder id; returns the parsed definition and the `dataPath` to read next, or a `skipped` result. Never throws |
| `validateCardFolder` | `(input: ValidateCardFolderInput) => FolderResult` | Whole folder: `card.json` text plus the data file (`DataInput`). Result is `ok`, `no-data`, `broken` or `skipped`. The one entry point the server and `validate` use. Never throws |
| `validateAlertFile` | `(input: ValidateAlertFileInput) => AlertResult` | One alert file: `{ name, text, mtimeMs, now? }`; id is the name stem. Result is `ok` or `broken` |
| `isCardFolderName` | `(name: string) => 'ok' \| 'invalid' \| 'reserved' \| 'ignore'` | Classifies a `feed/` entry name: `reserved` is `alerts`, `ignore` is dot-prefixed |
| `listTypes` | `() => RegisteredType[]` | `markdown`, `table`, `list`, `kpi`, `media` |
| `getExample` | `(type: string) => Example \| undefined` | Cloned example folder `{ card, data }`; `undefined` for an unknown type |
| `dataRequired` | `(type: string) => boolean` | Whether the type needs a data file (always true today; seam for future data-optional types) |
| `parseDuration` | `(value: string) => number` | `30m`, `12h`, `7d`, `2w` to ms; throws on invalid |
| `windowActive` | `(show, now: Date, opts?: { timezone?: string }) => boolean` | Is `now` inside a `show` window; `show` undefined is always active |
| `cellText` | `(cell: Cell) => string \| number \| boolean \| null` | Displayed value of a table cell |

## Values

`registry`: map of type name to `{ schema (zod payload schema), summary, template: { card, data } }`. The single place card types are registered.

## Types

- `DataInput`: `{ text: string; mtimeMs: number }` (data file read), `{ absent: true }` or `{ unreadable: string }`.
- `ValidateCardFolderInput`: `{ folderId: string; cardText: string | null; data: DataInput; now?: Date }`. `ValidateAlertFileInput`: `{ name: string; text: string; mtimeMs: number; now?: Date }`.
- Results: `DefResult` (`ok` with `def`, `dataPath` or `SkippedResult`), `FolderResult` (`{ status: 'ok'; card: ValidCard; warnings }`, `{ status: 'no-data'; card: NoDataCard; warnings }`, `BrokenResult`, `SkippedResult`), `AlertResult` (`{ status: 'ok'; alert: ValidAlert; warnings }` or a broken result). `ValidCard`, `NoDataCard`, `ValidAlert`, `BrokenResult`, `SkippedResult` are exported too.
- `FolderIssue`: `{ path: string (JSON pointer); message: string }`.
- `UpdatedAtSource`: `'data' | 'mtime'` (where the effective `updatedAt` came from).
- `BrokenReason`: `unreadable | malformed-json | not-object | too-large | schema-invalid | unknown-type`. `SkipReason`: `card-def-missing | card-def-invalid | data-path-invalid | invalid-id | reserved-id`. Meanings: [errors.md](errors.md).
- Contract shapes: `CardDef`, `CardDefInput`, `Layout`, `Show`, `DataFile`, `DataFileInput`, `Alert`.
- `Example`, `RegisteredType`, `KnownType` (alias).
- Data types: `MarkdownData`, `TableData`, `Cell`, `Column`, `ListData`, `ListItem`, `Action`, `KpiData`, `KpiMetric`, `MediaData`, `MediaItem`.

Field semantics: [card-schema.md](card-schema.md). The earlier single-file `validateCardFile` is gone with the single-file card model.
