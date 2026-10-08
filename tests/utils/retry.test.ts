import { describe, expect, it } from 'vitest';
import { retryOnBusy } from '../../src/utils/retry.js';

const err = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

function flaky(failures: number, code = 'EPERM') {
  let calls = 0;
  return {
    fn: () => {
      calls++;
      if (calls <= failures) throw err(code);
      return 'ok';
    },
    calls: () => calls,
  };
}

describe('retryOnBusy', () => {
  it('returns immediately on success', async () => {
    const f = flaky(0);
    expect(await retryOnBusy(f.fn, { tries: 3, backoffMs: 10, sleep: async () => {} })).toBe('ok');
    expect(f.calls()).toBe(1);
  });

  it('retries EPERM with doubling backoff, then succeeds', async () => {
    const f = flaky(3);
    const waits: number[] = [];
    const r = await retryOnBusy(f.fn, { tries: 5, backoffMs: 20, sleep: async (ms) => void waits.push(ms) });
    expect(r).toBe('ok');
    expect(waits).toEqual([20, 40, 80]);
  });

  it('rethrows after the last try', async () => {
    const f = flaky(10);
    await expect(retryOnBusy(f.fn, { tries: 3, backoffMs: 1, sleep: async () => {} })).rejects.toMatchObject({ code: 'EPERM' });
    expect(f.calls()).toBe(3);
  });

  it('does not retry other codes unless listed', async () => {
    const f = flaky(1, 'EBUSY');
    await expect(retryOnBusy(f.fn, { tries: 3, backoffMs: 1, sleep: async () => {} })).rejects.toMatchObject({ code: 'EBUSY' });
    expect(f.calls()).toBe(1);
    const g = flaky(1, 'EBUSY');
    expect(await retryOnBusy(g.fn, { tries: 3, backoffMs: 1, codes: ['EBUSY', 'EPERM'], sleep: async () => {} })).toBe('ok');
  });

  it('awaits async fns and rethrows errors without a code', async () => {
    let n = 0;
    expect(await retryOnBusy(async () => (++n < 2 ? Promise.reject(err('EPERM')) : n), { tries: 3, backoffMs: 1, sleep: async () => {} })).toBe(2);
    await expect(retryOnBusy(() => { throw new Error('plain'); }, { tries: 3, backoffMs: 1, sleep: async () => {} })).rejects.toThrow('plain');
  });
});
