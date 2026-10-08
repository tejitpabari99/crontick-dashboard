import { describe, it, expect } from 'vitest';
import { windowActive } from '../../src/index.js';

describe('windowActive cron at local midnight, show.for omitted', () => {
  it('active mid-day (UTC)', () => {
    expect(windowActive({ cron: '0 0 * * *' }, new Date('2026-10-05T10:00:00Z'), { timezone: 'UTC' })).toBe(true);
  });
  it('active at exactly 00:00 (UTC)', () => {
    expect(windowActive({ cron: '0 0 * * *' }, new Date('2026-10-05T00:00:00Z'), { timezone: 'UTC' })).toBe(true);
  });
  it('active mid-day in America/Los_Angeles', () => {
    // 2026-10-05T20:00Z = 13:00 PDT
    expect(windowActive({ cron: '0 0 * * *' }, new Date('2026-10-05T20:00:00Z'), { timezone: 'America/Los_Angeles' })).toBe(true);
  });
  it('active at exactly local midnight in America/Los_Angeles', () => {
    // 2026-10-05T07:00Z = 00:00 PDT
    expect(windowActive({ cron: '0 0 * * *' }, new Date('2026-10-05T07:00:00Z'), { timezone: 'America/Los_Angeles' })).toBe(true);
  });
});
