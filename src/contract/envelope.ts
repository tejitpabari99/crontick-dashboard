import { z } from 'zod';
import { cronSchema, durationSchema, timestampSchema } from './formats.js';

/** Known card types. Per-type validation and unknown-type handling live elsewhere (registry). */
export const KNOWN_TYPES = ['markdown', 'table', 'list', 'kpi', 'media'] as const;
export type KnownType = (typeof KNOWN_TYPES)[number];

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

function isValidId(v: string): boolean {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(v)) return false;
  if (v.endsWith('.')) return false;
  // Windows reserves the name before the first dot, with or without extension.
  return !WINDOWS_RESERVED.test(v.split('.')[0]!);
}

export const idSchema = z.string().refine(isValidId, {
  message:
    'id must match ^[a-z0-9][a-z0-9._-]{0,63}$, not end with ".", and not be a Windows reserved name (con, prn, aux, nul, com1-9, lpt1-9)',
});

export const showSchema = z.looseObject({
  cron: cronSchema,
  for: durationSchema.optional(),
});

/**
 * Card envelope. Unknown keys are preserved untouched everywhere (C2).
 * Keys starting with `x-` are reserved: the contract will never use them, agents may.
 */
export const envelopeSchema = z
  .looseObject({
    id: idSchema,
    kind: z.enum(['panel', 'alert']),
    type: z.string(),
    title: z.string().min(1).max(200),
    updatedAt: timestampSchema,
    priority: z.number().int().min(0).max(5).default(2),
    notify: z.boolean().default(false),
    show: showSchema.optional(),
    staleAfter: durationSchema.optional(),
    retention: durationSchema.optional(),
    size: z.enum(['S', 'M', 'L']).default('M'),
    error: z
      .string()
      .nullable()
      .transform((v) => (v === '' ? null : v))
      .default(null),
    data: z.looseObject({}).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.data === undefined && v.error === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['data'],
        message: 'data is required unless error is set to a non-empty string',
      });
    }
  });

export type Envelope = z.infer<typeof envelopeSchema>;
export type EnvelopeInput = z.input<typeof envelopeSchema>;
export type Show = z.infer<typeof showSchema>;
