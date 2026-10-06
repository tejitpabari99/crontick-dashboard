import { describe, expect, it } from 'vitest';
import { validateCardFile, listTypes, getExample, parseDuration, windowActive, cellText } from '../../src/index.js';

const base = {
  id: 'my-card',
  kind: 'panel',
  type: 'markdown',
  title: 'Hello',
  updatedAt: '2026-10-05T10:00:00Z',
  data: { text: 'x' },
};
const v = (o: Record<string, unknown>, opts?: { filename?: string; now?: Date }) =>
  validateCardFile(JSON.stringify({ ...base, ...o }), opts);

function broken(r: ReturnType<typeof validateCardFile>) {
  if (!('broken' in r)) throw new Error('expected broken, got ok');
  return r;
}

describe('validateCardFile', () => {
  it('ok card', () => {
    const r = v({});
    expect('ok' in r && r.ok).toBe(true);
  });
  it('unreadable', () => {
    expect(broken(validateCardFile('{"a":"�"}')).reason).toBe('unreadable');
    expect(broken(validateCardFile('{"a":"\uD800"}')).reason).toBe('unreadable');
    expect(broken(validateCardFile(undefined as unknown as string)).reason).toBe('unreadable');
  });
  it('malformed-json incl. empty and truncated', () => {
    expect(broken(validateCardFile('')).reason).toBe('malformed-json');
    expect(broken(validateCardFile('  \n')).reason).toBe('malformed-json');
    expect(broken(validateCardFile('{"id": "a"')).reason).toBe('malformed-json');
  });
  it('not-object', () => {
    expect(broken(validateCardFile('[]')).reason).toBe('not-object');
    expect(broken(validateCardFile('null')).reason).toBe('not-object');
    expect(broken(validateCardFile('3')).reason).toBe('not-object');
  });
  it('too-large', () => {
    const r = broken(validateCardFile(JSON.stringify({ ...base, data: { text: 'x'.repeat(1_100_000) } })));
    expect(r.reason).toBe('too-large');
  });
  it('schema-invalid with JSON pointer paths', () => {
    const r = broken(
      v({ type: 'table', data: { columns: ['a', 'b'], rows: [{ cells: ['1'] }] } }),
    );
    expect(r.reason).toBe('schema-invalid');
    expect(r.issues.some((i) => i.path === '/data/rows/0/cells')).toBe(true);
    expect(r.message).not.toContain('\n');
    expect(r.id).toBe('my-card');
  });
  it('envelope schema-invalid keeps id when parseable', () => {
    const r = broken(v({ title: '' }));
    expect(r.reason).toBe('schema-invalid');
    expect(r.id).toBe('my-card');
  });
  it('no id when unparseable', () => {
    const r = broken(v({ id: 'BAD ID' }));
    expect(r.id).toBeUndefined();
  });
  it('unknown-type with id', () => {
    const r = broken(v({ type: 'chart' }));
    expect(r.reason).toBe('unknown-type');
    expect(r.id).toBe('my-card');
  });
  it('id-mismatch', () => {
    const r = broken(v({}, { filename: 'other.json' }));
    expect(r.reason).toBe('id-mismatch');
    expect(r.id).toBe('my-card');
    const ok = v({}, { filename: 'my-card.json' });
    expect('ok' in ok).toBe(true);
  });
  it('error card is ok, data may be absent', () => {
    const rest: Record<string, unknown> = { ...base };
    delete rest.data;
    const r = validateCardFile(JSON.stringify({ ...rest, error: 'x' }));
    expect('ok' in r && r.ok && r.card.error).toBe('x');
  });
  it('staleAfter never evaluated', () => {
    const r = v({ staleAfter: '1m', updatedAt: '2020-01-01T00:00:00Z' });
    expect('ok' in r).toBe(true);
    if ('ok' in r) expect(r.warnings).toEqual([]);
  });
  it('alert with show ok', () => {
    const r = v({ kind: 'alert', show: { cron: '0 9 * * *', for: '2h' } });
    expect('ok' in r).toBe(true);
  });
  it('table/media on alert broken', () => {
    const t = broken(v({ kind: 'alert', type: 'table', data: { columns: ['a'], rows: [] } }));
    expect(t.reason).toBe('schema-invalid');
    expect(t.issues[0]!.path).toBe('/type');
    const m = broken(v({ kind: 'alert', type: 'media', data: { items: [] } }));
    expect(m.reason).toBe('schema-invalid');
  });
  it('future skew warns', () => {
    const now = new Date('2026-10-05T10:00:00Z');
    const r = v({ updatedAt: '2026-10-05T11:00:00Z' }, { now });
    expect('ok' in r && r.warnings.length).toBe(1);
    const inSkew = v({ updatedAt: '2026-10-05T10:04:00Z' }, { now });
    expect('ok' in inSkew && inSkew.warnings.length).toBe(0);
  });
  it('registry and helper exports', () => {
    expect(listTypes().sort()).toEqual(['kpi', 'list', 'markdown', 'media', 'table']);
    expect(typeof getExample).toBe('function');
    expect(parseDuration('2h')).toBe(7_200_000);
    expect(typeof windowActive).toBe('function');
    expect(cellText({ text: 'a' })).toBe('a');
  });
  it('never throws on garbage', () => {
    for (const s of ['\u0000', '{', '{"id":1}', '{"type":{}}', '"x"', 'true']) {
      expect(() => validateCardFile(s, { filename: 'x.json' })).not.toThrow();
    }
  });
});
