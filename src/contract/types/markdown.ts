import { z } from 'zod';

export const markdownDataSchema = z.looseObject({
  text: z.string().max(100_000),
});

export type MarkdownData = z.infer<typeof markdownDataSchema>;
