import { describe, expect, it } from 'vitest';
import { placeCards, SIZE_DIMS } from '../src/lib/placement.ts';

describe('placement', () => {
  it('size defaults', () => {
    expect(SIZE_DIMS).toEqual({ S: { w: 3, h: 4 }, M: { w: 3, h: 7 }, L: { w: 6, h: 9 } });
    const out = placeCards([], [{ id: 'a' }, { id: 'b', size: 'S' }, { id: 'c', size: 'L' }]);
    expect(out[0]).toEqual({ i: 'a', x: 0, y: 0, w: 3, h: 7 });
    expect(out[1]).toEqual({ i: 'b', x: 3, y: 0, w: 3, h: 4 });
    expect(out[2]).toEqual({ i: 'c', x: 6, y: 0, w: 6, h: 9 });
  });
  it('fills first free slot scanning rows then x; wraps to next row', () => {
    const out = placeCards([], ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, size: 'S' as const })));
    expect(out.map((l) => [l.x, l.y])).toEqual([[0, 0], [3, 0], [6, 0], [9, 0], [0, 4]]);
  });
  it('finds a hole beside existing cards', () => {
    const existing = [{ i: 'a', x: 0, y: 0, w: 3, h: 7 }, { i: 'c', x: 6, y: 0, w: 6, h: 9 }];
    const out = placeCards(existing, [{ id: 'a' }, { id: 'b', size: 'S' }, { id: 'c' }]);
    expect(out.find((l) => l.i === 'b')).toEqual({ i: 'b', x: 3, y: 0, w: 3, h: 4 });
  });
  it('never moves existing entries and keeps absent-card entries untouched', () => {
    const existing = [{ i: 'a', x: 5, y: 2, w: 3, h: 7 }, { i: 'gone', x: 0, y: 0, w: 3, h: 7 }];
    const out = placeCards(existing, [{ id: 'a' }, { id: 'b' }]);
    expect(out.slice(0, 2)).toEqual(existing);
    // absent card's slot does not block placement
    expect(out[2]).toEqual({ i: 'b', x: 0, y: 0, w: 3, h: 7 });
  });
  it('returns the same array when nothing is unplaced', () => {
    const existing = [{ i: 'a', x: 0, y: 0, w: 3, h: 7 }];
    expect(placeCards(existing, [{ id: 'a' }])).toBe(existing);
  });
});
