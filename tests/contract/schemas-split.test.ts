import { describe, expect, it } from 'vitest';
import { cardDefSchema, dataPathProblem, hasStrayId } from '../../src/contract/card-def.js';
import { dataFileSchema } from '../../src/contract/data-file.js';
import { alertSchema } from '../../src/contract/alert.js';
import { BROKEN_REASONS, SKIP_REASONS } from '../../src/constants/error-codes.js';

const def = (o: Record<string, unknown> = {}) => cardDefSchema.safeParse({ type: 'markdown', title: 'T', ...o });

describe('reason lists', () => {
  it('match the PRD sets and omit id-mismatch', () => {
    expect([...BROKEN_REASONS]).toEqual(['unreadable', 'malformed-json', 'not-object', 'too-large', 'schema-invalid', 'unknown-type']);
    expect([...SKIP_REASONS]).toEqual(['card-def-missing', 'card-def-invalid', 'data-path-invalid', 'invalid-id', 'reserved-id']);
    expect([...BROKEN_REASONS, ...SKIP_REASONS]).not.toContain('id-mismatch');
  });
});

describe('cardDefSchema', () => {
  it('applies defaults', () => {
    const r = def();
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.data).toBe('data.json');
    expect(r.data.layout).toEqual({ column: 'center', order: 0, height: 'auto' });
    expect(r.data.notify).toBe(false);
    expect(r.data.priority).toBeUndefined();
  });
  it('applies nested layout defaults', () => {
    const r = def({ layout: { column: 'left' } });
    expect(r.success && r.data.layout).toMatchObject({ column: 'left', order: 0, height: 'auto' });
  });
  it('validates layout, priority, title', () => {
    expect(def({ layout: { column: 'top' } }).success).toBe(false);
    expect(def({ layout: { height: 'XL' } }).success).toBe(false);
    expect(def({ layout: { order: 1.5 } }).success).toBe(false);
    expect(def({ priority: 6 }).success).toBe(false);
    expect(def({ priority: 0 }).success).toBe(true);
    expect(def({ priority: 5 }).success).toBe(true);
    expect(def({ title: '' }).success).toBe(false);
    expect(def({ title: 'x'.repeat(201) }).success).toBe(false);
    expect(cardDefSchema.safeParse({ title: 'T' }).success).toBe(false);
  });
  it('accepts show and staleAfter, rejects bad ones', () => {
    expect(def({ show: { cron: '0 9 * * *', for: '2h' }, staleAfter: '1d' }).success).toBe(true);
    expect(def({ show: { cron: 'nope' } }).success).toBe(false);
    expect(def({ staleAfter: 'soon' }).success).toBe(false);
  });
  it('preserves unknown, x- and removed-field extras silently', () => {
    const r = def({ 'x-agent': { a: 1 }, span: 2, size: 'L', retention: '7d', kind: 'panel', $schema: '../../schemas/card-def.json' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toMatchObject({ 'x-agent': { a: 1 }, span: 2, size: 'L', retention: '7d', kind: 'panel' });
  });
  it('keeps stray id detectable', () => {
    const r = def({ id: 'other' });
    expect(r.success && hasStrayId(r.data)).toBe(true);
    const r2 = def();
    expect(r2.success && hasStrayId(r2.data)).toBe(false);
  });
});

describe('data path rule', () => {
  const bad: [string, string][] = [
    ['leading slash', '/data.json'],
    ['nested', 'sub/data.json'],
    ['trailing slash', 'a.json/'],
    ['parent', '../data.json'],
    ['dot dot', '..'],
    ['dot', '.'],
    ['dot-prefixed', '.hidden.json'],
    ['backslash', 'a\\b.json'],
    ['NUL', 'a\u0000.json'],
    ['control', 'a\nb.json'],
    ['DEL', 'a\u007f.json'],
    ['non-json', 'data.txt'],
    ['no extension', 'data'],
    ['card.json', 'card.json'],
    ['empty', ''],
    ['too long', 'a'.repeat(196) + '.json'],
  ];
  it.each(bad)('rejects %s', (_n, v) => {
    expect(dataPathProblem(v)).not.toBeNull();
    const r = def({ data: v });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path[0] === 'data')).toBe(true);
  });
  it.each(['data.json', 'my-data.json', 'a b.json', 'x'.repeat(195) + '.json', 'Card.json'])('accepts %s', (v) => {
    expect(dataPathProblem(v)).toBeNull();
    expect(def({ data: v }).success).toBe(true);
  });
  it('rejects non-string data', () => {
    expect(def({ data: 5 }).success).toBe(false);
  });
});

describe('dataFileSchema', () => {
  it('accepts payload with defaults', () => {
    const r = dataFileSchema.safeParse({ data: { text: 'x' } });
    expect(r.success && r.data.error).toBeNull();
    expect(r.success && r.data.priority).toBeUndefined();
    expect(r.success && r.data.updatedAt).toBeUndefined();
  });
  it('requires object payload unless error set', () => {
    expect(dataFileSchema.safeParse({}).success).toBe(false);
    expect(dataFileSchema.safeParse({ data: 'str' }).success).toBe(false);
    expect(dataFileSchema.safeParse({ data: [] }).success).toBe(false);
    expect(dataFileSchema.safeParse({ error: '' }).success).toBe(false);
  });
  it('error: "" becomes null; non-empty makes payload optional and unvalidated', () => {
    const empty = dataFileSchema.safeParse({ data: {}, error: '' });
    expect(empty.success && empty.data.error).toBeNull();
    const e = dataFileSchema.safeParse({ error: 'fetch failed' });
    expect(e.success && e.data.error).toBe('fetch failed');
    expect(dataFileSchema.safeParse({ error: 'x', data: 42 }).success).toBe(true);
    expect(dataFileSchema.safeParse({ data: {}, error: null }).success).toBe(true);
  });
  it('validates priority and updatedAt', () => {
    expect(dataFileSchema.safeParse({ data: {}, priority: 6 }).success).toBe(false);
    expect(dataFileSchema.safeParse({ data: {}, updatedAt: '2026-10-05' }).success).toBe(false);
    expect(dataFileSchema.safeParse({ data: {}, updatedAt: '2026-10-05T10:00:00Z', priority: 3 }).success).toBe(true);
  });
  it('preserves extras and stray id', () => {
    const r = dataFileSchema.safeParse({ data: {}, 'x-run': 1, id: 'z', size: 'L' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toMatchObject({ 'x-run': 1, id: 'z', size: 'L' });
    expect(hasStrayId(r.data)).toBe(true);
  });
});

describe('alertSchema', () => {
  it('accepts title only with defaults', () => {
    const r = alertSchema.safeParse({ title: 'Disk full' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.priority).toBe(2);
    expect(r.data.notify).toBe(false);
    expect(r.data.text).toBeUndefined();
  });
  it('title rules', () => {
    expect(alertSchema.safeParse({}).success).toBe(false);
    expect(alertSchema.safeParse({ title: '' }).success).toBe(false);
    expect(alertSchema.safeParse({ title: 'x'.repeat(200) }).success).toBe(true);
    expect(alertSchema.safeParse({ title: 'x'.repeat(201) }).success).toBe(false);
  });
  it('text rules', () => {
    const t = (text: unknown) => alertSchema.safeParse({ title: 'a', text }).success;
    expect(t('one line')).toBe(true);
    expect(t('x'.repeat(200))).toBe(true);
    expect(t('x'.repeat(201))).toBe(false);
    expect(t('')).toBe(false);
    expect(t('a\nb')).toBe(false);
    expect(t('a\rb')).toBe(false);
    expect(t('a\u2028b')).toBe(false);
    expect(t('a\u2029b')).toBe(false);
    expect(t(5)).toBe(false);
  });
  it('link, priority, notify, show', () => {
    expect(alertSchema.safeParse({ title: 'a', link: 'https://example.com' }).success).toBe(true);
    expect(alertSchema.safeParse({ title: 'a', link: 'javascript:alert(1)' }).success).toBe(false);
    expect(alertSchema.safeParse({ title: 'a', priority: 6 }).success).toBe(false);
    expect(alertSchema.safeParse({ title: 'a', priority: 0, notify: true, show: { cron: '0 9 * * *' } }).success).toBe(true);
  });
  it('preserves extras and stray id', () => {
    const r = alertSchema.safeParse({ title: 'a', 'x-k': 1, id: 'q', kind: 'alert' });
    expect(r.success && r.data).toMatchObject({ 'x-k': 1, id: 'q', kind: 'alert' });
    expect(r.success && hasStrayId(r.data)).toBe(true);
  });
});
