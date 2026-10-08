import { z } from 'zod';
import { timestampSchema } from './formats.js';

/**
 * data.json: agent-written content. Generic wrapper; the per-type payload schema is applied
 * by the validator via the registry (skipped when `error` is set).
 */
export const dataFileSchema = z
  .looseObject({
    $schema: z.string().optional(),
    data: z.unknown().optional(),
    priority: z.number().int().min(0).max(5).optional(),
    updatedAt: timestampSchema.optional(),
    error: z
      .string()
      .nullable()
      .transform((v) => (v === '' ? null : v))
      .default(null),
  })
  .superRefine((v, ctx) => {
    if (v.error !== null) return; // agent-declared failure: payload optional, not validated
    if (typeof v.data !== 'object' || v.data === null || Array.isArray(v.data)) {
      ctx.addIssue({
        code: 'custom',
        path: ['data'],
        message: 'data must be an object unless error is set to a non-empty string',
      });
    }
  });

export type DataFile = z.infer<typeof dataFileSchema>;
export type DataFileInput = z.input<typeof dataFileSchema>;
