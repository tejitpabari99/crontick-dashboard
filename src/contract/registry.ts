import type { z } from 'zod';
import kpiExample from '../../templates/kpi.example.json' with { type: 'json' };
import listExample from '../../templates/list.example.json' with { type: 'json' };
import markdownExample from '../../templates/markdown.example.json' with { type: 'json' };
import mediaExample from '../../templates/media.example.json' with { type: 'json' };
import tableExample from '../../templates/table.example.json' with { type: 'json' };
import { kpiDataSchema } from './types/kpi.js';
import { listDataSchema } from './types/list.js';
import { markdownDataSchema } from './types/markdown.js';
import { mediaDataSchema } from './types/media.js';
import { tableDataSchema } from './types/table.js';

export type CardKind = 'panel' | 'alert';

export interface TypeEntry {
  schema: z.ZodType;
  /** File name under templates/ (the same JSON is embedded below, so no fs access is needed). */
  example: string;
  /** Parsed template card, embedded at build time (bundler-safe, no DOM/fs deps). */
  exampleCard: unknown;
  /** UI component name for 03/04 to key off. */
  component: string;
  allowedKinds: readonly CardKind[];
}

/** The single place card types are registered (D7). */
export const registry = {
  markdown: { schema: markdownDataSchema, example: 'markdown.example.json', exampleCard: markdownExample, component: 'MarkdownCard', allowedKinds: ['panel', 'alert'] },
  table: { schema: tableDataSchema, example: 'table.example.json', exampleCard: tableExample, component: 'TableCard', allowedKinds: ['panel'] },
  list: { schema: listDataSchema, example: 'list.example.json', exampleCard: listExample, component: 'ListCard', allowedKinds: ['panel', 'alert'] },
  kpi: { schema: kpiDataSchema, example: 'kpi.example.json', exampleCard: kpiExample, component: 'KpiCard', allowedKinds: ['panel', 'alert'] },
  media: { schema: mediaDataSchema, example: 'media.example.json', exampleCard: mediaExample, component: 'MediaCard', allowedKinds: ['panel'] },
} as const satisfies Record<string, TypeEntry>;

export type RegisteredType = keyof typeof registry;

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
