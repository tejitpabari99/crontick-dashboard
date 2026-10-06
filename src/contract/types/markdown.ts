import { z } from 'zod';
import { asRecord, asText } from '../../utils/guards.js';
import { stripMarkdown } from '../../utils/markdown.js';

export const markdownDataSchema = z.looseObject({
  text: z.string().max(100_000),
});

export type MarkdownData = z.infer<typeof markdownDataSchema>;

/** Notification summary: first non-empty line, markdown syntax stripped. */
export function markdownSummary(data: unknown): string {
  for (const raw of asText(asRecord(data)['text']).split(/\r?\n/)) {
    const s = stripMarkdown(raw);
    if (s !== '') return s;
  }
  return '';
}
