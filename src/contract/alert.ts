import { z } from 'zod';
import { showSchema } from './card-def.js';
import { linkSchema, timestampSchema } from './formats.js';

const LINE_BREAKS = /[\n\r\u2028\u2029]/;

/** Alert file (`feed/alerts/<id>.json`); id is the file name stem. */
export const alertSchema = z.looseObject({
  $schema: z.string().optional(),
  title: z.string().min(1).max(200),
  text: z
    .string()
    .min(1)
    .max(200)
    .refine((v) => !LINE_BREAKS.test(v), { message: 'text must be a single line' })
    .optional(),
  link: linkSchema.optional(),
  priority: z.number().int().min(0).max(5).default(2),
  notify: z.boolean().default(false),
  show: showSchema.optional(),
  updatedAt: timestampSchema.optional(),
});

export type Alert = z.infer<typeof alertSchema>;
export type AlertInput = z.input<typeof alertSchema>;
