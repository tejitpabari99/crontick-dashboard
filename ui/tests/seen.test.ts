import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEEN_KEY, isUnseen, markSeen } from '../src/lib/seen.ts';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('seen', () => {
  it('first visit: all unseen', () => {
    expect(isUnseen({ id: 'a', updatedAt: 't1' })).toBe(true);
  });
  it('markSeen records updatedAt; changed updatedAt is unseen again', () => {
    markSeen({ id: 'a', updatedAt: 't1' });
    expect(JSON.parse(localStorage.getItem(SEEN_KEY)!)).toEqual({ a: 't1' });
    expect(isUnseen({ id: 'a', updatedAt: 't1' })).toBe(false);
    expect(isUnseen({ id: 'a', updatedAt: 't2' })).toBe(true);
    expect(isUnseen({ id: 'b', updatedAt: 't1' })).toBe(true);
  });
  it('corrupt storage = unseen', () => {
    localStorage.setItem(SEEN_KEY, '{not json');
    expect(isUnseen({ id: 'a', updatedAt: 't1' })).toBe(true);
    localStorage.setItem(SEEN_KEY, '[1]');
    expect(isUnseen({ id: 'a', updatedAt: 't1' })).toBe(true);
  });
  it('read failure = unseen, no throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(isUnseen({ id: 'a', updatedAt: 't1' })).toBe(true);
    expect(() => markSeen({ id: 'a', updatedAt: 't1' })).not.toThrow();
  });
  it('write failure does not throw', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => markSeen({ id: 'a', updatedAt: 't1' })).not.toThrow();
  });
});
