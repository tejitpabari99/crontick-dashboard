import { describe, expect, it } from 'vitest';
import { cellText as srcCellText } from '../../../src/contract/index.js';
import {
  cellText,
  distinctValues,
  filterRows,
  inferColumnType,
  nextSort,
  normalizeColumns,
  sortRows,
  tableSearchText,
} from '../../src/types/table/logic.ts';
import type { Cell, TableData } from '../../../src/index.js';

type Row = { cells: Cell[] };
const r = (...cells: Cell[]): Row => ({ cells });
const col0 = (rows: Row[]) => rows.map((x) => cellText(x.cells[0]!));

describe('cellText parity with 01', () => {
  it('matches', () => {
    for (const c of ['a', 1, true, false, null, { text: 'x' }, { text: 5, link: 'https://a.b' }, { text: null }] as Cell[]) {
      expect(cellText(c)).toBe(srcCellText(c));
    }
  });
});

describe('normalizeColumns', () => {
  it('handles strings and objects', () => {
    expect(normalizeColumns(['A', { key: 'k', label: 'B', sort: 'number' }, { label: 'C' }])).toEqual([
      { label: 'A' },
      { key: 'k', label: 'B', sort: 'number' },
      { label: 'C' },
    ]);
  });
});

describe('inferColumnType', () => {
  it('numbers incl. stripped symbols', () => {
    expect(inferColumnType([1, '2', '$1,200', '45%', '€3.5'], undefined)).toBe('number');
  });
  it('>=80% numeric tolerates outliers; <80% is text', () => {
    expect(inferColumnType(['1', '2', '3', '4', 'n/a'], undefined)).toBe('number');
    expect(inferColumnType(['1', '2', '3', 'x', 'y'], undefined)).toBe('text');
  });
  it('nulls ignored; all null is text', () => {
    expect(inferColumnType([null, '5', null, 7], undefined)).toBe('number');
    expect(inferColumnType([null, null], undefined)).toBe('text');
  });
  it('dates', () => {
    expect(inferColumnType(['2024-01-02', '2024-01-03T10:00:00Z', null], undefined)).toBe('date');
    expect(inferColumnType(['2024-13-45', 'foo'], undefined)).toBe('text');
  });
  it('cell objects use text; booleans are text', () => {
    expect(inferColumnType([{ text: '10' }, { text: 2 }], undefined)).toBe('number');
    expect(inferColumnType([true, false], undefined)).toBe('text');
  });
  it('explicit wins', () => {
    expect(inferColumnType(['1', '2'], 'text')).toBe('text');
  });
});

describe('sortRows', () => {
  it('numeric 9 < 10', () => {
    const rows = [r('10'), r('9'), r('100')];
    expect(col0(sortRows(rows, 0, 'asc', 'number'))).toEqual(['9', '10', '100']);
    expect(col0(sortRows(rows, 0, 'desc', 'number'))).toEqual(['100', '10', '9']);
  });
  it('does not mutate input', () => {
    const rows = [r('b'), r('a')];
    sortRows(rows, 0, 'asc', 'text');
    expect(col0(rows)).toEqual(['b', 'a']);
  });
  it('dates', () => {
    const rows = [r('2024-03-01'), r('2023-12-31T23:00:00Z'), r('2024-01-15')];
    expect(col0(sortRows(rows, 0, 'asc', 'date'))).toEqual(['2023-12-31T23:00:00Z', '2024-01-15', '2024-03-01']);
  });
  it('text via localeCompare, numeric option off', () => {
    const rows = [r('b'), r('a10'), r('a9'), r('A')];
    expect(col0(sortRows(rows, 0, 'asc', 'text'))).toEqual(['A', 'a10', 'a9', 'b']);
  });
  it('nulls last in both directions', () => {
    const rows = [r(null), r('2'), r({ text: null }), r('1')];
    expect(col0(sortRows(rows, 0, 'asc', 'number'))).toEqual(['1', '2', null, null]);
    expect(col0(sortRows(rows, 0, 'desc', 'number'))).toEqual(['2', '1', null, null]);
  });
  it('stable on ties both directions', () => {
    const rows = [r(1, 'a'), r(1, 'b'), r(0, 'c'), r(1, 'd')];
    expect(sortRows(rows, 0, 'asc', 'number').map((x) => x.cells[1])).toEqual(['c', 'a', 'b', 'd']);
    expect(sortRows(rows, 0, 'desc', 'number').map((x) => x.cells[1])).toEqual(['a', 'b', 'd', 'c']);
  });
  it('cell-object text sorted', () => {
    const rows = [r({ text: 'z', link: 'https://x.y' }), r({ text: 'a' })];
    expect(col0(sortRows(rows, 0, 'asc', 'text'))).toEqual(['a', 'z']);
  });
  it('unparseable under explicit number goes last', () => {
    const rows = [r('abc'), r('1')];
    expect(col0(sortRows(rows, 0, 'asc', 'number'))).toEqual(['1', 'abc']);
  });
});

describe('nextSort', () => {
  it('cycles asc -> desc -> default', () => {
    const def = { column: 2, dir: 'desc' as const };
    expect(nextSort(def, 0)).toEqual({ column: 0, dir: 'asc' });
    expect(nextSort({ column: 0, dir: 'asc' }, 0)).toEqual({ column: 0, dir: 'desc' });
    expect(nextSort({ column: 0, dir: 'desc' }, 0, def)).toEqual(def);
    expect(nextSort({ column: 0, dir: 'desc' }, 0)).toBeNull();
    expect(nextSort(null, 1)).toEqual({ column: 1, dir: 'asc' });
  });
});

describe('filterRows', () => {
  const rows = [r('Alice', 'Paris'), r({ text: 'Bob', link: 'https://x.y' }, 'Rome'), r('Carol', null)];
  it('empty returns all', () => {
    expect(filterRows(rows, { query: '', ownQuery: '', filters: {} })).toHaveLength(3);
  });
  it('searches cell-object text, case-insensitive', () => {
    expect(filterRows(rows, { ownQuery: 'BOB' })).toEqual([rows[1]]);
  });
  it('tokens AND, across cells', () => {
    expect(filterRows(rows, { ownQuery: 'alice paris' })).toEqual([rows[0]]);
    expect(filterRows(rows, { ownQuery: 'alice rome' })).toEqual([]);
  });
  it('own AND global query', () => {
    expect(filterRows(rows, { query: 'o', ownQuery: 'rome' })).toEqual([rows[1]]);
    expect(filterRows(rows, { query: 'alice', ownQuery: 'rome' })).toEqual([]);
  });
  it('column filters AND across columns', () => {
    const rs = [r('a', 'x'), r('a', 'y'), r('b', 'x')];
    expect(filterRows(rs, { filters: { 0: new Set(['a']) } })).toHaveLength(2);
    expect(filterRows(rs, { filters: { 0: new Set(['a']), 1: new Set(['x']) } })).toEqual([rs[0]]);
    expect(filterRows(rs, { filters: { 0: new Set(['a', 'b']), 1: new Set() } })).toHaveLength(3);
  });
  it('null cell text is empty string for filters', () => {
    expect(filterRows(rows, { filters: { 1: new Set(['']) } })).toEqual([rows[2]]);
  });
});

describe('distinctValues', () => {
  it('2-20 distinct, sorted, as strings', () => {
    expect(distinctValues([r('b'), r('a'), r('b')], 0)).toEqual(['a', 'b']);
  });
  it('null when 1 or >20 distinct', () => {
    expect(distinctValues([r('a'), r('a')], 0)).toBeNull();
    const many = Array.from({ length: 21 }, (_, i) => r(`v${i}`));
    expect(distinctValues(many, 0)).toBeNull();
    expect(distinctValues(many.slice(0, 20), 0)).toHaveLength(20);
  });
  it('cell objects use text; null -> empty string', () => {
    expect(distinctValues([r({ text: 'a' }), r(null), r('a')], 0)).toEqual(['', 'a']);
  });
});

describe('tableSearchText', () => {
  it('labels + all cells', () => {
    const d = {
      columns: ['Name', { label: 'City' }],
      rows: [{ cells: ['Al', { text: 'Paris', link: 'https://x.y' }] }, { cells: [null, 3] }],
      searchable: true,
    } as unknown as TableData;
    const t = tableSearchText(d);
    for (const s of ['Name', 'City', 'Al', 'Paris', '3']) expect(t).toContain(s);
  });
  it('total on empty or malformed data', () => {
    expect(tableSearchText({ columns: [], rows: [], searchable: true } as unknown as TableData)).toBe('');
    expect(tableSearchText({ columns: ['A'], rows: [{ cells: ['x', 'extra'] }, {}], extra: 1 } as unknown as TableData)).toContain('extra');
    expect(tableSearchText(undefined as never)).toBe('');
  });
});
