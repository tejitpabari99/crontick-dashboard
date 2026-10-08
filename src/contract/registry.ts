import type { z } from 'zod';
import kpiCard from '../../templates/kpi/card.json' with { type: 'json' };
import kpiData from '../../templates/kpi/data.json' with { type: 'json' };
import listCard from '../../templates/list/card.json' with { type: 'json' };
import listData from '../../templates/list/data.json' with { type: 'json' };
import markdownCard from '../../templates/markdown/card.json' with { type: 'json' };
import markdownData from '../../templates/markdown/data.json' with { type: 'json' };
import mediaCard from '../../templates/media/card.json' with { type: 'json' };
import mediaData from '../../templates/media/data.json' with { type: 'json' };
import tableCard from '../../templates/table/card.json' with { type: 'json' };
import tableData from '../../templates/table/data.json' with { type: 'json' };
import { kpiDataSchema, kpiSummary } from './types/kpi.js';
import { listDataSchema, listSummary } from './types/list.js';
import { markdownDataSchema, markdownSummary } from './types/markdown.js';
import { mediaDataSchema, mediaSummary } from './types/media.js';
import { tableDataSchema, tableSummary } from './types/table.js';

/** Embedded example card folder: card.json + data.json contents. */
export interface Example {
  card: Record<string, unknown>;
  data: Record<string, unknown>;
}

export interface TypeEntry {
  /** Payload schema for this type's `data` (the `data` key of data.json). */
  schema: z.ZodType;
  /** Plain-text one-line notification summary of this type's `data` (defensive: data may be unvalidated on error cards). */
  summary: (data: unknown) => string;
  /** Example folder, embedded at build time from templates/<type>/ (bundler-safe, no fs). */
  template: Example;
}

/** The single place card types are registered (D7). */
export const registry = {
  markdown: { schema: markdownDataSchema, summary: markdownSummary, template: { card: markdownCard, data: markdownData } },
  table: { schema: tableDataSchema, summary: tableSummary, template: { card: tableCard, data: tableData } },
  list: { schema: listDataSchema, summary: listSummary, template: { card: listCard, data: listData } },
  kpi: { schema: kpiDataSchema, summary: kpiSummary, template: { card: kpiCard, data: kpiData } },
  media: { schema: mediaDataSchema, summary: mediaSummary, template: { card: mediaCard, data: mediaData } },
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

/** Example folder ({ card, data }) for a type; undefined if unknown type. */
export function getExample(type: string): Example | undefined {
  return isRegisteredType(type) ? structuredClone(registry[type].template) as Example : undefined;
}

/**
 * Whether a card of this type must have a data file. Always true today; seam for a future
 * per-type `dataOptional` registry flag.
 */
export function dataRequired(type: string): boolean {
  void type;
  return true;
}
