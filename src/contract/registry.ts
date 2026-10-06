import type { z } from 'zod';
import kpiExample from '../../templates/kpi.example.json' with { type: 'json' };
import listExample from '../../templates/list.example.json' with { type: 'json' };
import markdownExample from '../../templates/markdown.example.json' with { type: 'json' };
import mediaExample from '../../templates/media.example.json' with { type: 'json' };
import tableExample from '../../templates/table.example.json' with { type: 'json' };
import { kpiDataSchema, kpiSummary } from './types/kpi.js';
import { listDataSchema, listSummary } from './types/list.js';
import { markdownDataSchema, markdownSummary } from './types/markdown.js';
import { mediaDataSchema, mediaSummary } from './types/media.js';
import { tableDataSchema, tableSummary } from './types/table.js';

export type CardKind = 'panel' | 'alert';

export interface TypeEntry {
  schema: z.ZodType;
  /** File name under templates/ (the same JSON is embedded below, so no fs access is needed). */
  example: string;
  /** Parsed template card, embedded at build time (bundler-safe, no DOM/fs deps). */
  exampleCard: unknown;
  /** Plain-text one-line notification summary of this type's `data` (defensive: data may be unvalidated on error cards). */
  summary: (data: unknown) => string;
  allowedKinds: readonly CardKind[];
}

/** The single place card types are registered (D7). */
export const registry = {
  markdown: { schema: markdownDataSchema, example: 'markdown.example.json', exampleCard: markdownExample, summary: markdownSummary, allowedKinds: ['panel', 'alert'] },
  table: { schema: tableDataSchema, example: 'table.example.json', exampleCard: tableExample, summary: tableSummary, allowedKinds: ['panel'] },
  list: { schema: listDataSchema, example: 'list.example.json', exampleCard: listExample, summary: listSummary, allowedKinds: ['panel', 'alert'] },
  kpi: { schema: kpiDataSchema, example: 'kpi.example.json', exampleCard: kpiExample, summary: kpiSummary, allowedKinds: ['panel', 'alert'] },
  media: { schema: mediaDataSchema, example: 'media.example.json', exampleCard: mediaExample, summary: mediaSummary, allowedKinds: ['panel'] },
} as const satisfies Record<string, TypeEntry>;

export type RegisteredType = keyof typeof registry;
/** Alias of `RegisteredType`: the registry is the only list of type names. */
export type KnownType = RegisteredType;

export function isRegisteredType(t: string): t is RegisteredType {
  return Object.prototype.hasOwnProperty.call(registry, t);
}

export function listTypes(): RegisteredType[] {
  return Object.keys(registry) as RegisteredType[];
}

/** Example template card (parsed JSON) for a type; undefined if unknown type. */
export function getExample(type: string): unknown {
  return isRegisteredType(type) ? structuredClone(registry[type].exampleCard) : undefined;
}

/** Example template file name (under templates/) for a type; undefined if unknown type. */
export function getExampleFile(type: string): string | undefined {
  return isRegisteredType(type) ? registry[type].example : undefined;
}
