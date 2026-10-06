import { describe, expect, it } from 'vitest';
import { findItemAction } from '../../src/actions/lookup.js';

describe('findItemAction', () => {
  const data = { items: [{ id: 'a', action: { type: 'dismiss' } }, { id: 'b' }, { id: 'c', action: 'x' }, 5] };
  it('returns the action type of the item', () => {
    expect(findItemAction(data, 'a')).toEqual({ type: 'dismiss' });
  });
  it('item without a (usable) action has an undefined type', () => {
    expect(findItemAction(data, 'b')).toEqual({ type: undefined });
    expect(findItemAction(data, 'c')).toEqual({ type: undefined });
  });
  it('unknown item, missing items or bad data is undefined', () => {
    expect(findItemAction(data, 'zzz')).toBeUndefined();
    expect(findItemAction({}, 'a')).toBeUndefined();
    expect(findItemAction({ items: 'x' }, 'a')).toBeUndefined();
    expect(findItemAction(undefined, 'a')).toBeUndefined();
  });
});
