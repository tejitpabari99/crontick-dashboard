import type { z } from 'zod';
import { kpiDataSchema } from './types/kpi.js';
import { listDataSchema } from './types/list.js';
import { markdownDataSchema } from './types/markdown.js';
import { mediaDataSchema } from './types/media.js';
import { tableDataSchema } from './types/table.js';

export type CardKind = 'panel' | 'alert';

export interface TypeEntry {
  schema: z.ZodType;
  /** File name under templates/ (wired up by the templates task). */
  example: string;
  allowedKinds: readonly CardKind[];
}

/** The single place card types are registered (D7). */
export const registry = {
  markdown: { schema: markdownDataSchema, example: 'markdown.example.json', allowedKinds: ['panel', 'alert'] },
  table: { schema: tableDataSchema, example: 'table.example.json', allowedKinds: ['panel'] },
  list: { schema: listDataSchema, example: 'list.example.json', allowedKinds: ['panel', 'alert'] },
  kpi: { schema: kpiDataSchema, example: 'kpi.example.json', allowedKinds: ['panel', 'alert'] },
  media: { schema: mediaDataSchema, example: 'media.example.json', allowedKinds: ['panel'] },
} as const satisfies Record<string, TypeEntry>;

export type RegisteredType = keyof typeof registry;

export function isRegisteredType(t: string): t is RegisteredType {
  return Object.prototype.hasOwnProperty.call(registry, t);
}

export function listTypes(): RegisteredType[] {
  return Object.keys(registry) as RegisteredType[];
}

/** Example template file name for a type (templates/<name>); undefined if unknown type. */
export function getExample(type: string): string | undefined {
  return isRegisteredType(type) ? registry[type].example : undefined;
}
