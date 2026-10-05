import { afterEach, describe, expect, it, vi } from 'vitest';
import { sleep } from '../../src/utils/sleep.js';

describe('sleep', () => {
  afterEach(() => vi.useRealTimers());

  it('resolves after the delay', async () => {
    vi.useFakeTimers();
    const done = vi.fn();
    void sleep(50).then(done);
    await vi.advanceTimersByTimeAsync(49);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledOnce();
  });

  it('uses injected timers when given', async () => {
    const calls: number[] = [];
    const timers = { setTimeout: (fn: () => void, ms: number) => (calls.push(ms), fn(), 1), clearTimeout: () => {} };
    await sleep(7, timers);
    expect(calls).toEqual([7]);
  });
});
