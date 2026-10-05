import { describe, expect, it } from 'vitest';
import { tableDataSchema, cellText } from '../../src/contract/types/table.js';
import { listDataSchema } from '../../src/contract/types/list.js';

describe('table', () => {
  it('accepts string and object columns, cell links, row link, extras', () => {
    const r = tableDataSchema.parse({
      columns: ['A', { key: 'b', label: 'B', sort: 'number' }],
      rows: [
        {
          cells: ['x', { text: 'Unsub', link: 'https://u.test', 'x-c': 1 }],
          link: 'https://r.test',
          'x-r': 2,
        },
      ],
      defaultSort: { column: 0, dir: 'asc' },
      'x-d': 3,
    });
    expect(r['x-d']).toBe(3);
    expect(r.rows[0]!['x-r']).toBe(2);
    expect((r.rows[0]!.cells[1] as Record<string, unknown>)['x-c']).toBe(1);
    expect(r.searchable).toBe(true);
  });
  it('searchable false kept', () => {
    expect(
      tableDataSchema.parse({ columns: ['A'], rows: [], searchable: false }).searchable,
    ).toBe(false);
  });
  it('rejects javascript: cell link', () => {
    const r = tableDataSchema.safeParse({
      columns: ['A'],
      rows: [{ cells: [{ text: 'x', link: 'javascript:alert(1)' }] }],
    });
    expect(r.success).toBe(false);
  });
  it('rejects length mismatch', () => {
    expect(tableDataSchema.safeParse({ columns: ['A', 'B'], rows: [{ cells: ['x'] }] }).success).toBe(false);
  });
  it('rejects 0 or 51 columns, bad sort', () => {
    expect(tableDataSchema.safeParse({ columns: [], rows: [] }).success).toBe(false);
    expect(
      tableDataSchema.safeParse({ columns: Array.from({ length: 51 }, () => 'a'), rows: [] }).success,
    ).toBe(false);
    expect(tableDataSchema.safeParse({ columns: [{ label: 'a', sort: 'x' }], rows: [] }).success).toBe(false);
  });
  it('accepts null/boolean/number cells; cellText', () => {
    const r = tableDataSchema.parse({
      columns: ['a', 'b', 'c', 'd'],
      rows: [{ cells: [null, true, 3, { text: null }] }],
    });
    expect(r.rows).toHaveLength(1);
    expect(cellText('s')).toBe('s');
    expect(cellText(4)).toBe(4);
    expect(cellText(null)).toBe(null);
    expect(cellText({ text: 'hi', link: 'https://x.test' })).toBe('hi');
  });
});

describe('list', () => {
  it('accepts full item with extras', () => {
    const r = listDataSchema.parse({
      items: [
        {
          text: 't', id: 'a', subtitle: 's', checked: true, checkedAt: '2026-10-05T10:00:00+02:00',
          due: '2026-10-06', link: 'https://x.test',
          links: [{ text: 'Unsub', link: 'https://u.test' }],
          action: 'complete', ticktick: { taskId: '1' },
        },
      ],
      emptyText: 'none',
      'x-e': 1,
    });
    expect(r.items[0]!['ticktick']).toEqual({ taskId: '1' });
    expect(r['x-e']).toBe(1);
  });
  it('due forms', () => {
    const mk = (due: string) => listDataSchema.safeParse({ items: [{ text: 't', due }] }).success;
    expect(mk('2026-10-06')).toBe(true);
    expect(mk('2026-10-06T10:00:00Z')).toBe(true);
    expect(mk('tomorrow')).toBe(false);
    expect(mk('2026-10-06T10:00:00')).toBe(false);
  });
  it('links[] max 5 and link rules', () => {
    const l = { text: 'a', link: 'https://x.test' };
    expect(listDataSchema.safeParse({ items: [{ text: 't', links: Array(5).fill(l) }] }).success).toBe(true);
    expect(listDataSchema.safeParse({ items: [{ text: 't', links: Array(6).fill(l) }] }).success).toBe(false);
    expect(
      listDataSchema.safeParse({ items: [{ text: 't', links: [{ text: 'a', link: 'javascript:1' }] }] }).success,
    ).toBe(false);
  });
  it('normalizes action shorthand', () => {
    const r = listDataSchema.parse({
      items: [
        { text: 'a', id: '1', action: 'dismiss' },
        { text: 'b', id: '2', action: 'complete' },
        { text: 'c', id: '3', action: { type: 'complete', x: 1 } },
      ],
    });
    expect(r.items[0]!.action).toEqual({ type: 'dismiss' });
    expect(r.items[1]!.action).toEqual({ type: 'complete' });
    expect(r.items[2]!.action).toEqual({ type: 'complete', x: 1 });
  });
  it('requires id with action; unique ids', () => {
    expect(listDataSchema.safeParse({ items: [{ text: 'a', action: 'dismiss' }] }).success).toBe(false);
    expect(
      listDataSchema.safeParse({
        items: [{ text: 'a', id: '1' }, { text: 'b', id: '1' }],
      }).success,
    ).toBe(false);
  });
  it('rejects unknown action types', () => {
    expect(
      listDataSchema.safeParse({ items: [{ text: 'a', id: '1', action: { type: 'ticktick.complete' } }] }).success,
    ).toBe(false);
    expect(listDataSchema.safeParse({ items: [{ text: 'a', id: '1', action: 'foo' }] }).success).toBe(false);
  });
});
