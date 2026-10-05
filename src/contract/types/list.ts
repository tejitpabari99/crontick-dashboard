import { z } from 'zod';
import { dueSchema, linkSchema, timestampSchema } from '../formats.js';

export const actionSchema = z.preprocess(
  (v) => (typeof v === 'string' ? { type: v } : v),
  z.looseObject({ type: z.enum(['dismiss', 'complete']) }),
);

export const listLinkSchema = z.looseObject({ text: z.string(), link: linkSchema });

export const listItemSchema = z
  .looseObject({
    text: z.string(),
    id: z.string().min(1).optional(),
    subtitle: z.string().optional(),
    checked: z.boolean().optional(),
    checkedAt: timestampSchema.optional(),
    due: dueSchema.optional(),
    link: linkSchema.optional(),
    links: z.array(listLinkSchema).max(5).optional(),
    action: actionSchema.optional(),
  })
  .superRefine((item, ctx) => {
    if (item.action !== undefined && item.id === undefined) {
      ctx.addIssue({ code: 'custom', message: 'id is required when action is present', path: ['id'] });
    }
  });

export const listDataSchema = z
  .looseObject({
    items: z.array(listItemSchema),
    emptyText: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    data.items.forEach((item, i) => {
      if (item.id === undefined) return;
      if (seen.has(item.id)) {
        ctx.addIssue({ code: 'custom', message: `duplicate item id "${item.id}"`, path: ['items', i, 'id'] });
      }
      seen.add(item.id);
    });
  });

export type ListItem = z.infer<typeof listItemSchema>;
export type ListData = z.infer<typeof listDataSchema>;
export type Action = z.infer<typeof actionSchema>;
