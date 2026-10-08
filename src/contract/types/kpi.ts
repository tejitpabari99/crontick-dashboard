import { z } from 'zod';
import { asRecord, asRecords, asText } from '../../utils/guards.js';
import { linkSchema } from '../formats.js';

export const kpiTrendSchema = z.looseObject({
  delta: z.number(),
  dir: z.enum(['up', 'down', 'flat']).optional(),
  good: z.enum(['up', 'down']).optional(),
});

export const kpiMetricSchema = z.looseObject({
  value: z.union([z.string(), z.number()]),
  label: z.string().optional(),
  unit: z.string().optional(),
  state: z.enum(['ok', 'pending', 'fail', 'warn']).optional(),
  trend: kpiTrendSchema.optional(),
  link: linkSchema.optional(),
});

const itemsSchema = z.array(kpiMetricSchema).min(1).max(12);
const METRIC_KEYS = ['value', 'label', 'unit', 'state', 'trend', 'link'] as const;

/**
 * kpi data. Canonical form is `items`; the flat single-metric form (metric keys
 * at the top level of `data`) is normalized to `items` of length 1. Both = invalid.
 */
export const kpiDataSchema = z
  .looseObject({ items: itemsSchema.optional() })
  .transform((data, ctx) => {
    const flatKeys = METRIC_KEYS.filter((k) => k in data);
    if (data.items !== undefined) {
      if (flatKeys.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: `kpi data must use either "items" or the flat form, not both (found ${flatKeys.join(', ')})`,
        });
        return z.NEVER;
      }
      return data as typeof data & { items: z.infer<typeof itemsSchema> };
    }
    if (!('value' in data)) {
      ctx.addIssue({ code: 'custom', message: 'kpi data requires "items" or a flat "value"' });
      return z.NEVER;
    }
    const metric: Record<string, unknown> = {};
    const extras: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (k === 'items') continue;
      if ((METRIC_KEYS as readonly string[]).includes(k)) metric[k] = v;
      else extras[k] = v;
    }
    const parsed = z.array(kpiMetricSchema).length(1).safeParse([metric]);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path.slice(1) });
      }
      return z.NEVER;
    }
    return { ...extras, items: parsed.data };
  });

export type KpiMetric = z.infer<typeof kpiMetricSchema>;
export type KpiData = z.infer<typeof kpiDataSchema>;

/** Notification summary: first metric as "<value><unit> <label>". */
export function kpiSummary(data: unknown): string {
  const m = asRecords(asRecord(data)['items'])[0];
  return m ? `${asText(m['value'])}${asText(m['unit'])} ${asText(m['label'])}`.trim() : '';
}
