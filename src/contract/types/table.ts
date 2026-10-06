import { z } from 'zod';
import { asRecord, asRecords } from '../../utils/guards.js';
import { plural } from '../../utils/text.js';
import { linkSchema } from '../formats.js';

const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const cellSchema = z.union([
  scalarSchema,
  z.looseObject({ text: scalarSchema, link: linkSchema.optional() }),
]);

export const columnSchema = z.union([
  z.string(),
  z.looseObject({
    key: z.string().optional(),
    label: z.string(),
    sort: z.enum(['text', 'number', 'date']).optional(),
  }),
]);

export const tableRowSchema = z.looseObject({
  cells: z.array(cellSchema),
  link: linkSchema.optional(),
});

export const tableDataSchema = z
  .looseObject({
    columns: z.array(columnSchema).min(1).max(50),
    rows: z.array(tableRowSchema),
    defaultSort: z
      .looseObject({ column: z.number().int().min(0), dir: z.enum(['asc', 'desc']) })
      .optional(),
    searchable: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    data.rows.forEach((row, i) => {
      if (row.cells.length !== data.columns.length) {
        ctx.addIssue({
          code: 'custom',
          message: `row has ${row.cells.length} cells but table has ${data.columns.length} columns`,
          path: ['rows', i, 'cells'],
        });
      }
    });
    if (data.defaultSort && data.defaultSort.column >= data.columns.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'defaultSort.column is out of range',
        path: ['defaultSort', 'column'],
      });
    }
  });

export type Cell = z.infer<typeof cellSchema>;
export type TableData = z.infer<typeof tableDataSchema>;

/** The displayed/searched/sorted value of a cell. */
export function cellText(cell: Cell): string | number | boolean | null {
  return cell !== null && typeof cell === 'object' ? cell.text : cell;
}
export type Column = z.infer<typeof columnSchema>;

/** Notification summary: "N rows". */
export function tableSummary(data: unknown): string {
  return plural(asRecords(asRecord(data)['rows']).length, 'row');
}
