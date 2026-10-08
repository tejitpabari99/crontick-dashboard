import { describe, expect, it } from 'vitest';
import { asRecord, asRecords, asText, isObj } from '../../src/utils/guards.js';
import { stripMarkdown } from '../../src/utils/markdown.js';
import { plural } from '../../src/utils/text.js';

describe('guards', () => {
  it('isObj accepts plain objects only', () => {
    expect(isObj({})).toBe(true);
    for (const v of [null, undefined, [], 'x', 1]) expect(isObj(v)).toBe(false);
  });
  it('asRecord / asRecords coerce non-objects to empty', () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord([1])).toEqual({});
    expect(asRecords([{ a: 1 }, 5, null])).toEqual([{ a: 1 }, {}, {}]);
    expect(asRecords('x')).toEqual([]);
  });
  it('asText stringifies strings and numbers only', () => {
    expect(asText('a')).toBe('a');
    expect(asText(4)).toBe('4');
    expect(asText(true)).toBe('');
    expect(asText(undefined)).toBe('');
  });
});

describe('text helpers', () => {
  it('stripMarkdown', () => {
    expect(stripMarkdown('> - _Disk_ at ![](u) [x](y) 95%')).toBe('Disk at x 95%');
  });
  it('plural', () => {
    expect(plural(1, 'row')).toBe('1 row');
    expect(plural(0, 'row')).toBe('0 rows');
  });
});
