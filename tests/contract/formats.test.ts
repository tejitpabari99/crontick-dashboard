import { describe, expect, it } from 'vitest';
import {
  durationSchema,
  parseDuration,
  cronSchema,
  timestampSchema,
  dueSchema,
  linkSchema,
  mediaSrcSchema,
  windowActive,
} from '../../src/contract/formats.js';

const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  expect(s.safeParse(v).success).toBe(true);
const bad = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  expect(s.safeParse(v).success).toBe(false);

describe('duration', () => {
  it.each(['30m', '12h', '26h', '7d', '2w', '3650d'])('accepts %s', (v) => ok(durationSchema, v));
  it.each(['7 days', '0m', '01h', '1h30m', '30s', '', '-1d', '3651d', '1.5h', 'h', 7, '3651d'])(
    'rejects %s',
    (v) => bad(durationSchema, v),
  );
  it('rejects 521w (>3650d)', () => bad(durationSchema, '522w'));
  it('parses to ms', () => {
    expect(parseDuration('30m')).toBe(30 * 60_000);
    expect(parseDuration('12h')).toBe(12 * 3_600_000);
    expect(parseDuration('7d')).toBe(7 * 86_400_000);
    expect(parseDuration('2w')).toBe(14 * 86_400_000);
  });
  it('parseDuration throws on invalid', () => {
    expect(() => parseDuration('7 days')).toThrow();
  });
});

describe('cron', () => {
  it.each(['0 9 * * *', '*/5 * * * *', '0 8 * * 1-5', '30 6 1 * *'])('accepts %s', (v) =>
    ok(cronSchema, v),
  );
  it.each(['@daily', '@hourly', '0 0 9 * * *', '* * * *', '', 'every day', '99 * * * *', 5])(
    'rejects %s',
    (v) => bad(cronSchema, v),
  );
});

describe('timestamp', () => {
  it.each([
    '2026-10-05T12:00:00Z',
    '2026-10-05T12:00:00.123Z',
    '2026-10-05T12:00:00+05:30',
    '2026-10-05T12:00:00-07:00',
  ])('accepts %s', (v) => ok(timestampSchema, v));
  it.each([
    '2026-10-05T12:00:00',
    '2026-10-05 12:00:00Z',
    '2026-10-05',
    '2026-13-05T12:00:00Z',
    '2026-02-30T12:00:00Z',
    '2026-10-05T25:00:00Z',
    'yesterday',
    '',
    1700000000,
  ])('rejects %s', (v) => bad(timestampSchema, v));
});

describe('list due', () => {
  it.each(['2026-10-05', '2026-10-05T12:00:00Z', '2026-10-05T12:00:00+02:00'])('accepts %s', (v) =>
    ok(dueSchema, v),
  );
  it.each(['tomorrow', '2026-10-05T12:00:00', '2026-02-30', '2026-1-5', '10/05/2026', ''])(
    'rejects %s',
    (v) => bad(dueSchema, v),
  );
});

describe('link', () => {
  it.each([
    'http://example.com',
    'https://example.com/a?b=1#c',
    'mailto:a@b.com',
    'ms-outlook://emails/123',
    'HTTPS://EXAMPLE.COM',
  ])('accepts %s', (v) => ok(linkSchema, v));
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'data:image/png;base64,AAAA',
    'file:///etc/passwd',
    'ftp://example.com',
    'tel:+1555',
    '/relative',
    'example.com',
    '',
  ])('rejects %s', (v) => bad(linkSchema, v));
  it('enforces <=2048 chars', () => {
    const base = 'https://example.com/';
    ok(linkSchema, base + 'a'.repeat(2048 - base.length));
    bad(linkSchema, base + 'a'.repeat(2049 - base.length));
  });
});

describe('media src', () => {
  it.each([
    'http://example.com/a.png',
    'https://example.com/a.gif',
    'data:image/png;base64,AAAA',
    'data:image/gif;base64,AAAA',
  ])('accepts %s', (v) => ok(mediaSrcSchema, v));
  it.each([
    'file:///a.png',
    'javascript:alert(1)',
    'data:text/html,x',
    'data:video/mp4;base64,AAAA',
    'ftp://x/a.png',
    'a.png',
    'mailto:a@b.com',
    '',
  ])('rejects %s', (v) => bad(mediaSrcSchema, v));
});

describe('windowActive', () => {
  const d = (s: string) => new Date(s);
  it('no show = always active', () => {
    expect(windowActive(undefined, d('2026-10-05T03:00:00Z'))).toBe(true);
  });
  it('with for: inside window', () => {
    const show = { cron: '0 9 * * *', for: '2h' };
    const o = { timezone: 'UTC' };
    expect(windowActive(show, d('2026-10-05T09:00:00Z'), o)).toBe(true);
    expect(windowActive(show, d('2026-10-05T10:59:00Z'), o)).toBe(true);
  });
  it('with for: outside window', () => {
    const show = { cron: '0 9 * * *', for: '2h' };
    const o = { timezone: 'UTC' };
    expect(windowActive(show, d('2026-10-05T08:59:00Z'), o)).toBe(false);
    expect(windowActive(show, d('2026-10-05T11:00:00Z'), o)).toBe(false);
  });
  it('for longer than cron period spans windows', () => {
    const show = { cron: '0 9 * * *', for: '2d' };
    expect(windowActive(show, d('2026-10-06T20:00:00Z'), { timezone: 'UTC' })).toBe(true);
  });
  it('for omitted: active until end of local day (UTC)', () => {
    const show = { cron: '0 9 * * *' };
    const o = { timezone: 'UTC' };
    expect(windowActive(show, d('2026-10-05T08:00:00Z'), o)).toBe(false);
    expect(windowActive(show, d('2026-10-05T09:00:00Z'), o)).toBe(true);
    expect(windowActive(show, d('2026-10-05T23:59:59Z'), o)).toBe(true);
    expect(windowActive(show, d('2026-10-06T00:00:00Z'), o)).toBe(false);
    expect(windowActive(show, d('2026-10-06T08:59:00Z'), o)).toBe(false);
  });
  it('timezone changes the day boundary (America/Los_Angeles, UTC-7 in Oct)', () => {
    const show = { cron: '0 9 * * *' };
    const o = { timezone: 'America/Los_Angeles' };
    // 09:00 PDT = 16:00Z
    expect(windowActive(show, d('2026-10-05T15:59:00Z'), o)).toBe(false);
    expect(windowActive(show, d('2026-10-05T16:00:00Z'), o)).toBe(true);
    // local end of day = 07:00Z next day
    expect(windowActive(show, d('2026-10-06T06:59:00Z'), o)).toBe(true);
    expect(windowActive(show, d('2026-10-06T07:00:00Z'), o)).toBe(false);
  });
  it('timezone with positive offset (Asia/Kolkata, +05:30)', () => {
    const show = { cron: '0 6 * * *' };
    const o = { timezone: 'Asia/Kolkata' };
    // 06:00 IST = 00:30Z; end of day = 18:30Z
    expect(windowActive(show, d('2026-10-05T00:29:00Z'), o)).toBe(false);
    expect(windowActive(show, d('2026-10-05T00:30:00Z'), o)).toBe(true);
    expect(windowActive(show, d('2026-10-05T18:29:00Z'), o)).toBe(true);
    expect(windowActive(show, d('2026-10-05T18:30:00Z'), o)).toBe(false);
  });
  it('for window crossing local midnight', () => {
    const show = { cron: '0 23 * * *', for: '3h' };
    const o = { timezone: 'UTC' };
    expect(windowActive(show, d('2026-10-06T01:59:00Z'), o)).toBe(true);
    expect(windowActive(show, d('2026-10-06T02:00:00Z'), o)).toBe(false);
  });
  it('defaults to local timezone when none given', () => {
    expect(typeof windowActive({ cron: '* * * * *' }, new Date())).toBe('boolean');
    expect(windowActive({ cron: '* * * * *', for: '1h' }, new Date())).toBe(true);
  });
});
