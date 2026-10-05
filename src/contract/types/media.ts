import { z } from 'zod';
import { linkSchema, mediaSrcSchema } from '../formats.js';

export const mediaItemSchema = z.looseObject({
  src: mediaSrcSchema,
  alt: z.string().optional(),
  caption: z.string().optional(),
  link: linkSchema.optional(),
});

export const mediaDataSchema = z.looseObject({
  items: z.array(mediaItemSchema).min(1).max(50),
  layout: z.enum(['grid', 'single']).optional(),
});

export type MediaItem = z.infer<typeof mediaItemSchema>;
export type MediaData = z.infer<typeof mediaDataSchema>;
