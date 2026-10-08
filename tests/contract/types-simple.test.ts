import { describe, expect, it } from 'vitest';
import { markdownDataSchema } from '../../src/contract/types/markdown.js';
import { kpiDataSchema } from '../../src/contract/types/kpi.js';
import { mediaDataSchema } from '../../src/contract/types/media.js';

describe('markdown', () => {
  it('accepts text and keeps extras', () => {
    const r = markdownDataSchema.parse({ text: 'hi', 'x-a': 1 });
    expect(r).toEqual({ text: 'hi', 'x-a': 1 });
  });
  it('rejects missing, non-string, >100k', () => {
    expect(markdownDataSchema.safeParse({}).success).toBe(false);
    expect(markdownDataSchema.safeParse({ text: 1 }).success).toBe(false);
    expect(markdownDataSchema.safeParse({ text: 'a'.repeat(100_001) }).success).toBe(false);
    expect(markdownDataSchema.safeParse({ text: 'a'.repeat(100_000) }).success).toBe(true);
  });
});

describe('kpi', () => {
  const full = {
    value: 42, label: 'L', unit: 'ms', state: 'ok',
    trend: { delta: -1.5, dir: 'down', good: 'down' }, link: 'https://x.test',
  };
  it('items form ok, extras preserved on data/items', () => {
    const r = kpiDataSchema.parse({ items: [{ ...full, 'x-m': 1 }, { value: 'Deployed' }], extra: 2 });
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ 'x-m': 1 });
    expect(r).toMatchObject({ extra: 2 });
  });
  it('flat form normalizes to items of length 1, extras kept', () => {
    const r = kpiDataSchema.parse({ ...full, extra: 'e', 'x-m': 1 });
    expect(r.items).toEqual([full]);
    // unknown flat keys are data-level extras
    expect(r).toMatchObject({ extra: 'e', 'x-m': 1 });
    expect('value' in r).toBe(false);
  });
  it('flat form with only value ok', () => {
    expect(kpiDataSchema.parse({ value: 'ok' }).items).toEqual([{ value: 'ok' }]);
  });
  it('both forms rejected', () => {
    expect(kpiDataSchema.safeParse({ items: [{ value: 1 }], value: 2 }).success).toBe(false);
    expect(kpiDataSchema.safeParse({ items: [{ value: 1 }], label: 'x' }).success).toBe(false);
  });
  it('neither form rejected', () => {
    expect(kpiDataSchema.safeParse({}).success).toBe(false);
    expect(kpiDataSchema.safeParse({ label: 'x' }).success).toBe(false);
  });
  it('items bounds 1-12', () => {
    expect(kpiDataSchema.safeParse({ items: [] }).success).toBe(false);
    expect(kpiDataSchema.safeParse({ items: Array(12).fill({ value: 1 }) }).success).toBe(true);
    expect(kpiDataSchema.safeParse({ items: Array(13).fill({ value: 1 }) }).success).toBe(false);
  });
  it('rejects bad state, trend, link', () => {
    expect(kpiDataSchema.safeParse({ value: 1, state: 'bad' }).success).toBe(false);
    expect(kpiDataSchema.safeParse({ value: 1, trend: { dir: 'up' } }).success).toBe(false);
    expect(kpiDataSchema.safeParse({ value: 1, trend: { delta: 1, dir: 'x' } }).success).toBe(false);
    expect(kpiDataSchema.safeParse({ value: 1, link: 'javascript:alert(1)' }).success).toBe(false);
    expect(kpiDataSchema.safeParse({ items: [{ value: 1, link: 'file:///x' }] }).success).toBe(false);
    expect(kpiDataSchema.safeParse({ items: [{ label: 'x' }] }).success).toBe(false);
  });
});

describe('media', () => {
  const it1 = (src: string) => mediaDataSchema.safeParse({ items: [{ src }] }).success;
  it('allows http(s) and data:image', () => {
    expect(it1('https://x.test/a.png')).toBe(true);
    expect(it1('http://x.test/a.gif')).toBe(true);
    expect(it1('data:image/png;base64,AAAA')).toBe(true);
  });
  it('denies file:, video, other', () => {
    expect(it1('file:///etc/a.png')).toBe(false);
    expect(it1('data:video/mp4;base64,AAAA')).toBe(false);
    expect(it1('javascript:alert(1)')).toBe(false);
    expect(it1('ftp://x.test/a.png')).toBe(false);
  });
  it('layout, extras, link rules, bounds', () => {
    const r = mediaDataSchema.parse({
      layout: 'grid', k: 1,
      items: [{ src: 'https://x.test/a.png', alt: 'a', caption: 'c', link: 'mailto:a@b.co', z: 2 }],
    });
    expect(r).toMatchObject({ k: 1, layout: 'grid' });
    expect(r.items[0]).toMatchObject({ z: 2 });
    expect(mediaDataSchema.safeParse({ layout: 'bad', items: [{ src: 'https://x.test/a' }] }).success).toBe(false);
    expect(mediaDataSchema.safeParse({ items: [{ src: 'https://x.test/a', link: 'file:///x' }] }).success).toBe(false);
    expect(mediaDataSchema.safeParse({ items: [] }).success).toBe(false);
    expect(mediaDataSchema.safeParse({ items: Array(50).fill({ src: 'https://x.test/a' }) }).success).toBe(true);
    expect(mediaDataSchema.safeParse({ items: Array(51).fill({ src: 'https://x.test/a' }) }).success).toBe(false);
  });
});
