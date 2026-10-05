import { afterEach, describe, expect, it, vi } from 'vitest';
import { realTimers } from '../../src/utils/timers.js';

describe('realTimers', () => {
  afterEach(() => vi.useRealTimers());

  it('setTimeout fires and clearTimeout cancels', () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    realTimers.setTimeout(fired, 100);
    const cancelled = vi.fn();
    realTimers.clearTimeout(realTimers.setTimeout(cancelled, 100));
    vi.advanceTimersByTime(100);
    expect(fired).toHaveBeenCalledOnce();
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('setInterval repeats until cleared', () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    const h = realTimers.setInterval(tick, 10);
    vi.advanceTimersByTime(35);
    realTimers.clearInterval(h);
    vi.advanceTimersByTime(100);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it('handles are unref d so they never hold the process open', () => {
    const t = realTimers.setTimeout(() => {}, 60_000) as NodeJS.Timeout;
    const i = realTimers.setInterval(() => {}, 60_000) as NodeJS.Timeout;
    expect(t.hasRef()).toBe(false);
    expect(i.hasRef()).toBe(false);
    realTimers.clearTimeout(t);
    realTimers.clearInterval(i);
  });
});
