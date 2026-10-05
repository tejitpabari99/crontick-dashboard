import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Cron } from 'croner';

describe('toolchain smoke', () => {
  it('runs vitest with zod 4 and croner', () => {
    expect(z.string().parse('ok')).toBe('ok');
    expect(new Cron('*/5 * * * *').nextRun()).toBeInstanceOf(Date);
  });
});
