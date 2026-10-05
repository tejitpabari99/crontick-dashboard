import { describe, expect, it } from 'vitest';
import { envelopeSchema, KNOWN_TYPES } from '../../src/contract/envelope.js';

const base = {
  id: 'my-card',
  kind: 'panel',
  type: 'markdown',
  title: 'Hello',
  updatedAt: '2026-10-05T10:00:00Z',
  data: { text: 'x' },
};
const parse = (o: Record<string, unknown>) => envelopeSchema.safeParse({ ...base, ...o });

describe('envelope', () => {
  it('applies defaults', () => {
    const r = envelopeSchema.parse(base);
    expect(r.priority).toBe(2);
    expect(r.notify).toBe(false);
    expect(r.size).toBe('M');
    expect(r.error).toBeNull();
    expect(r.show).toBeUndefined();
  });
  it('lists known types', () => {
    expect(KNOWN_TYPES).toEqual(['markdown', 'table', 'list', 'kpi', 'media']);
  });
  it.each(['a', 'my-card', 'a.b_c-1', '0abc', 'a'.repeat(64), 'console', 'com10'])('id ok %s', (id) =>
    expect(parse({ id }).success).toBe(true),
  );
  it.each([
    'CON', 'con', 'A/b', 'Abc', 'nul.txt', 'aux.x.y', 'com1', 'lpt9.log', 'a.', 'a b', 'a\\b', 'a:b',
    '', '-a', '.a', 'a'.repeat(65),
  ])('id rejected %j', (id) => expect(parse({ id }).success).toBe(false));
  it('rejects bad kind, empty/long title, naive timestamp', () => {
    expect(parse({ kind: 'x' }).success).toBe(false);
    expect(parse({ title: '' }).success).toBe(false);
    expect(parse({ title: 'a'.repeat(201) }).success).toBe(false);
    expect(parse({ updatedAt: '2026-10-05T10:00:00' }).success).toBe(false);
  });
  it('priority int 0-5', () => {
    for (const p of [0, 5]) expect(parse({ priority: p }).success).toBe(true);
    for (const p of [-1, 6, 2.5]) expect(parse({ priority: p }).success).toBe(false);
  });
  it('size, durations, show', () => {
    expect(parse({ size: 'L' }).success).toBe(true);
    expect(parse({ size: 'XL' }).success).toBe(false);
    expect(parse({ staleAfter: '12h', retention: '7d' }).success).toBe(true);
    expect(parse({ staleAfter: '7 days' }).success).toBe(false);
    expect(parse({ show: { cron: '0 9 * * 1-5', for: '2h' } }).success).toBe(true);
    expect(parse({ show: { cron: '0 9 * * 1-5' } }).success).toBe(true);
    expect(parse({ show: { cron: '* * * * * *' } }).success).toBe(false);
    expect(parse({ show: { cron: '0 9 * * *', for: 'x' } }).success).toBe(false);
  });
  it('preserves extras untouched, incl. x- keys', () => {
    const r = envelopeSchema.parse({ ...base, note: { a: 1 }, 'x-foo': 1, show: { cron: '0 9 * * *', extra: true } });
    expect(r).toMatchObject({ note: { a: 1 }, 'x-foo': 1, show: { extra: true } });
  });
  it('error handling', () => {
    expect(envelopeSchema.parse({ ...base, error: '' }).error).toBeNull();
    expect(envelopeSchema.parse({ ...base, error: null }).error).toBeNull();
    expect(envelopeSchema.parse({ ...base, error: 'boom' }).error).toBe('boom');
    expect(parse({ error: 5 }).success).toBe(false);
  });
  it('data omission rules', () => {
    const noData: Record<string, unknown> = { ...base };
    delete noData.data;
    expect(envelopeSchema.safeParse(noData).success).toBe(false);
    expect(envelopeSchema.safeParse({ ...noData, error: null }).success).toBe(false);
    expect(envelopeSchema.safeParse({ ...noData, error: '' }).success).toBe(false);
    expect(envelopeSchema.safeParse({ ...noData, error: 'boom' }).success).toBe(true);
    expect(parse({ data: 'str' }).success).toBe(false);
  });
});
