import { z } from 'zod';
import { asRecord, asRecords, asText } from '../../utils/guards.js';
import { stripMarkdown } from '../../utils/markdown.js';
import { plural } from '../../utils/text.js';
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

/** Notification summary: first caption, else "N images". */
export function mediaSummary(data: unknown): string {
  const items = asRecords(asRecord(data)['items']);
  if (items.length === 0) return '';
  const cap = stripMarkdown(asText(items[0]!['caption']));
  return cap !== '' ? cap : plural(items.length, 'image');
}
