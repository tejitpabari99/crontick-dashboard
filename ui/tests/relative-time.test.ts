import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatRelative, subscribeTicker, useNow } from '../src/lib/relative-time.ts';

describe('formatRelative', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it('formats', () => {
    expect(formatRelative(ago(0), now)).toBe('just now');
    expect(formatRelative(ago(59_000), now)).toBe('just now');
    expect(formatRelative(ago(60_000), now)).toBe('1m ago');
    expect(formatRelative(ago(59 * 60_000), now)).toBe('59m ago');
    expect(formatRelative(ago(3_600_000), now)).toBe('1h ago');
    expect(formatRelative(ago(2 * 3_600_000 + 5000), now)).toBe('2h ago');
    expect(formatRelative(ago(24 * 3_600_000), now)).toBe('1d ago');
    expect(formatRelative(ago(3 * 86_400_000), now)).toBe('3d ago');
  });
  it('future / invalid = just now', () => {
    expect(formatRelative(ago(-5000), now)).toBe('just now');
    expect(formatRelative('garbage', now)).toBe('just now');
  });
});

describe('ticker', () => {
  let hidden = false;
  const setHidden = (v: boolean) => {
    hidden = v;
    document.dispatchEvent(new Event('visibilitychange'));
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  });
  afterEach(() => vi.useRealTimers());

  it('one interval for all subscribers, ticks each 60s', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const a = vi.fn();
    const b = vi.fn();
    const ua = subscribeTicker(a);
    const ub = subscribeTicker(b);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    ua();
    ub();
    expect(vi.getTimerCount()).toBe(0);
    spy.mockRestore();
  });
  it('paused while hidden, immediate refresh on visible', () => {
    const a = vi.fn();
    const un = subscribeTicker(a);
    setHidden(true);
    vi.advanceTimersByTime(300_000);
    expect(a).not.toHaveBeenCalled();
    setHidden(false);
    expect(a).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(a).toHaveBeenCalledTimes(2);
    un();
  });
  it('useNow re-renders on tick', () => {
    const { result, unmount } = renderHook(() => useNow());
    const first = result.current;
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current - first).toBe(60_000);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
