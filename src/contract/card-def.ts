import { z } from 'zod';
import {
  CARD_DEF_FILE,
  DATA_PATH_EXT,
  DEFAULT_DATA_FILE,
  MAX_DATA_PATH_CHARS,
} from '../constants/contract.js';
import { cronSchema, durationSchema } from './formats.js';

export const showSchema = z.looseObject({
  cron: cronSchema,
  for: durationSchema.optional(),
});

/**
 * Lexical `data` path rule: a plain file name inside the card folder.
 * Returns a problem description, or null when valid. Pure; symlink containment is the reader's job.
 */
export function dataPathProblem(v: string): string | null {
  if (v.length < 1 || v.length > MAX_DATA_PATH_CHARS) return `must be 1-${MAX_DATA_PATH_CHARS} characters`;
  if (/[\u0000-\u001f\u007f\\]/.test(v)) return 'must not contain backslashes or control characters';
  if (v.includes('/')) return 'must be a plain file name (no "/", no subfolders)';
  if (v.startsWith('.')) return 'must not start with "."';
  if (!v.endsWith(DATA_PATH_EXT)) return `must end with ${DATA_PATH_EXT}`;
  if (v === CARD_DEF_FILE) return `must not be ${CARD_DEF_FILE}`;
  return null;
}

export const dataPathSchema = z.string().superRefine((v, ctx) => {
  const problem = dataPathProblem(v);
  if (problem) ctx.addIssue({ code: 'custom', message: `data path ${problem}` });
});

export const layoutSchema = z.looseObject({
  column: z.enum(['left', 'center', 'right']).default('center'),
  order: z.number().int().default(0),
  height: z.enum(['S', 'M', 'L', 'auto']).default('auto'),
});

/**
 * card.json: the view definition. Id comes from the folder name, never from the body.
 * Unknown keys preserved; `x-` reserved for agents. `size`/`retention`/`kind` are plain extras.
 */
export const cardDefSchema = z.looseObject({
  $schema: z.string().optional(),
  type: z.string(),
  title: z.string().min(1).max(200),
  data: dataPathSchema.default(DEFAULT_DATA_FILE),
  layout: layoutSchema.default(() => ({ column: 'center' as const, order: 0, height: 'auto' as const })),
  priority: z.number().int().min(0).max(5).optional(),
  notify: z.boolean().default(false),
  show: showSchema.optional(),
  staleAfter: durationSchema.optional(),
});

export type CardDef = z.infer<typeof cardDefSchema>;
export type CardDefInput = z.input<typeof cardDefSchema>;
export type Layout = z.infer<typeof layoutSchema>;
export type Show = z.infer<typeof showSchema>;

/** A stray `id` key in any contract file is kept but ignored; the validator warns. */
export function hasStrayId(obj: object): boolean {
  return Object.prototype.hasOwnProperty.call(obj, 'id');
}
