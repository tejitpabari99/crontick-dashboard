/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { validateCardFile, getLegacyExample } from '../../src/feed/legacy-envelope.js';
import { listTypes } from '../../src/index.js';
import { MAX_CARD_BYTES } from '../../src/constants/contract.js';

type R = ReturnType<typeof validateCardFile>;
const base = {
  id: 'my-card',
  kind: 'panel',
  type: 'markdown',
  title: 'Hello',
  updatedAt: '2026-10-05T10:00:00Z',
  data: { text: 'x' },
};
const run = (o: Record<string, unknown>): R => validateCardFile(JSON.stringify({ ...base, ...o }));
const okOf = (r: R) => {
  if (!('ok' in r)) throw new Error('expected ok, got ' + JSON.stringify(r));
  return r.card;
};
const badOf = (r: R) => {
  if (!('broken' in r)) throw new Error('expected broken');
  return r;
};
const table = (data: unknown, extra: Record<string, unknown> = {}) => run({ type: 'table', data, ...extra });
const list = (data: unknown) => run({ type: 'list', data });
const kpi = (data: unknown) => run({ type: 'kpi', data });
type D = Record<string, any>;
const tbl = (cell: unknown) => table({ columns: ['a'], rows: [{ cells: [cell] }] });

describe('AC1 examples + negative fixtures', () => {
  it('every template example validates ok', () => {
    for (const type of listTypes()) {
      const ex = getLegacyExample(type);
      expect(ex, type).toBeDefined();
      expect('ok' in validateCardFile(JSON.stringify(ex)), type).toBe(true);
    }
    expect(listTypes().length).toBe(5);
  });
  it.each(['id', 'kind', 'type', 'title', 'updatedAt', 'data'])('missing %s is broken', (k) => {
    const o: Record<string, unknown> = { ...base };
    delete o[k];
    expect('broken' in validateCardFile(JSON.stringify(o))).toBe(true);
  });
  it.each(['CON', 'con', 'nul.txt', 'A/b', 'Upper', 'a b', '', '.x', 'a.', '-a', 'x'.repeat(65)])(
    'bad id %j is broken',
    (id) => {
      expect(badOf(run({ id })).reason).toBe('schema-invalid');
    },
  );
  it('good ids ok', () => {
    for (const id of ['a', 'a.b_c-d', '0abc', 'x'.repeat(64)]) okOf(run({ id }));
  });
  it('duration 7 days is broken (staleAfter, retention, show.for)', () => {
    expect(badOf(run({ staleAfter: '7 days' })).reason).toBe('schema-invalid');
    expect(badOf(run({ retention: '7 days' })).reason).toBe('schema-invalid');
    expect(badOf(run({ show: { cron: '0 8 * * *', for: '7 days' } })).reason).toBe('schema-invalid');
    okOf(run({ staleAfter: '7d' }));
  });
  it('6-field cron is broken, 5-field ok', () => {
    expect(badOf(run({ show: { cron: '0 0 8 * * *' } })).reason).toBe('schema-invalid');
    expect(badOf(run({ show: { cron: 'nonsense' } })).reason).toBe('schema-invalid');
    okOf(run({ show: { cron: '0 8 * * *' } }));
  });
  it('naive timestamp is broken', () => {
    for (const ts of ['2026-10-05T10:00:00', '2026-10-05 10:00:00', '2026-10-05', 'yesterday']) {
      expect(badOf(run({ updatedAt: ts })).reason, ts).toBe('schema-invalid');
    }
    okOf(run({ updatedAt: '2026-10-05T10:00:00+05:30' }));
  });
  it('table row/column mismatch is broken', () => {
    const r = badOf(table({ columns: ['a', 'b'], rows: [{ cells: ['1'] }] }));
    expect(r.reason).toBe('schema-invalid');
    expect(r.issues.some((i) => i.path === '/data/rows/0/cells')).toBe(true);
  });
  it('unknown action is broken', () => {
    const item = { id: 'i', text: 't' };
    expect(badOf(list({ items: [{ ...item, action: 'delete' }] })).reason).toBe('schema-invalid');
    expect(badOf(list({ items: [{ ...item, action: { type: 'nuke' } }] })).reason).toBe('schema-invalid');
  });
  it('javascript: link is broken', () => {
    expect(badOf(table({ columns: ['a'], rows: [{ link: 'javascript:alert(1)', cells: ['x'] }] })).reason).toBe(
      'schema-invalid',
    );
    expect(badOf(list({ items: [{ text: 't', link: 'javascript:alert(1)' }] })).reason).toBe('schema-invalid');
    expect(badOf(kpi({ items: [{ label: 'l', value: 1, link: 'javascript:alert(1)' }] })).reason).toBe(
      'schema-invalid',
    );
  });
  it('table on alert is broken', () => {
    const r = badOf(table({ columns: ['a'], rows: [{ cells: ['x'] }] }, { kind: 'alert' }));
    expect(r.reason).toBe('schema-invalid');
    expect(r.id).toBe('my-card');
  });
});

describe('AC2 file-level reasons', () => {
  it('truncated JSON -> malformed-json', () => {
    const full = JSON.stringify(base);
    expect(badOf(validateCardFile(full.slice(0, full.length - 5))).reason).toBe('malformed-json');
  });
  it('[] -> not-object', () => {
    expect(badOf(validateCardFile('[]')).reason).toBe('not-object');
  });
  it('unknown type -> unknown-type with id', () => {
    const r = badOf(run({ type: 'gauge' }));
    expect(r.reason).toBe('unknown-type');
    expect(r.id).toBe('my-card');
  });
});

describe('AC3 extras preserved', () => {
  it('envelope and data extras', () => {
    const c = okOf(run({ 'x-agent': { a: 1 }, foo: 'bar', data: { text: 'x', extra: [1] } })) as Record<string, unknown>;
    expect(c['x-agent']).toEqual({ a: 1 });
    expect(c.foo).toBe('bar');
    expect((c.data as Record<string, unknown>).extra).toEqual([1]);
  });
  it('row, list item and kpi metric extras', () => {
    const t = okOf(table({ columns: ['a'], rows: [{ cells: ['x'], rowExtra: 7 }], tExtra: 1 })).data as D;
    expect(t.rows[0].rowExtra).toBe(7);
    expect(t.tExtra).toBe(1);
    const l = okOf(list({ items: [{ id: 'i', text: 't', priv: { k: 1 } }] })).data as D;
    expect(l.items[0].priv).toEqual({ k: 1 });
    const k = okOf(kpi({ items: [{ label: 'l', value: 1, metricExtra: 'm' }] })).data as D;
    expect(k.items[0].metricExtra).toBe('m');
  });
});

describe('AC4 per-type rules', () => {
  it('kpi items form ok; flat normalizes to 1 item; both forms broken', () => {
    expect((okOf(kpi({ items: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] })).data as D).items).toHaveLength(2);
    const flat = okOf(kpi({ label: 'a', value: 1 })).data as D;
    expect(flat.items).toHaveLength(1);
    expect(flat.items[0].label).toBe('a');
    expect(badOf(kpi({ label: 'a', value: 1, items: [{ label: 'b', value: 2 }] })).reason).toBe('schema-invalid');
  });
  it('table cell {text,link} ok; cellText used', () => {
    const c = okOf(tbl({ text: 'hi', link: 'https://e.com' }));
    const cell = (c.data as D).rows[0].cells[0];
    expect(cell).toEqual({ text: 'hi', link: 'https://e.com' });
  });
  it('table cellText helper', async () => {
    const { cellText } = await import('../../src/index.js');
    expect(cellText({ text: 'hi', link: 'https://e.com' })).toBe('hi');
    expect(cellText('s')).toBe('s');
  });
  it('table cell javascript: link is broken', () => {
    expect(badOf(tbl({ text: 'x', link: 'javascript:alert(1)' })).reason).toBe('schema-invalid');
  });
  it('list due date/datetime ok, "tomorrow" broken', () => {
    okOf(list({ items: [{ text: 't', due: '2026-10-05' }] }));
    okOf(list({ items: [{ text: 't', due: '2026-10-05T10:00:00Z' }] }));
    expect(badOf(list({ items: [{ text: 't', due: 'tomorrow' }] })).reason).toBe('schema-invalid');
  });
  it('list links[] ok', () => {
    okOf(list({ items: [{ text: 't', links: [{ text: 'a', link: 'https://e.com' }] }] }));
  });
  it('complete action without item.id broken; {type:"ticktick.complete"} broken', () => {
    expect(badOf(list({ items: [{ text: 't', action: 'complete' }] })).reason).toBe('schema-invalid');
    expect(badOf(list({ items: [{ id: 'i', text: 't', action: { type: 'ticktick.complete' } }] })).reason).toBe(
      'schema-invalid',
    );
    okOf(list({ items: [{ id: 'i', text: 't', action: 'complete' }] }));
  });
  it('links: ms-outlook: and mailto: ok; data:/file:/ftp: broken', () => {
    const l = (link: string) => list({ items: [{ text: 't', link }] });
    okOf(l('ms-outlook://emails/1'));
    okOf(l('mailto:a@b.com'));
    for (const bad of ['data:text/html,x', 'file:///etc/passwd', 'ftp://h/x', 'javascript:alert(1)']) {
      expect(badOf(l(bad)).reason, bad).toBe('schema-invalid');
    }
  });
});

describe('AC5/6 show and error', () => {
  it('card without show has no window; alert with show ok', () => {
    expect(okOf(run({})).show).toBeUndefined();
    okOf(run({ kind: 'alert', show: { cron: '0 8 * * *', for: '2h' } }));
  });
  it('error card ok with card.error; staleAfter not evaluated', () => {
    const r = validateCardFile(JSON.stringify({ ...base, data: undefined, error: 'x' }));
    expect(okOf(r).error).toBe('x');
    const old = okOf(run({ updatedAt: '2000-01-01T00:00:00Z', staleAfter: '1m' }));
    expect(old.staleAfter).toBe('1m');
  });
});

describe('AC8 fuzz: never throws', () => {
  const settle = (s: string) => {
    let r: R | undefined;
    expect(() => (r = validateCardFile(s))).not.toThrow();
    expect(r && ('ok' in r || 'broken' in r)).toBe(true);
    return r!;
  };
  it('random binary decoded as utf8 and latin1', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 300; i++) {
      const buf = Buffer.alloc(Math.floor(rnd() * 2000));
      for (let j = 0; j < buf.length; j++) buf[j] = Math.floor(rnd() * 256);
      settle(buf.toString('utf8'));
      settle(buf.toString('latin1'));
    }
  });
  it('mutated valid cards', () => {
    const s = JSON.stringify(getLegacyExample('table'));
    for (let i = 0; i < s.length; i += 7) {
      settle(s.slice(0, i));
      settle(s.slice(0, i) + '\u0000' + s.slice(i + 1));
    }
  });
  it('empty and 5 MB inputs', () => {
    expect(badOf(settle('')).reason).toBe('malformed-json');
    expect(badOf(settle('x'.repeat(5 * MAX_CARD_BYTES))).reason).toBe('too-large');
    expect(badOf(settle('[' + '1,'.repeat(2_500_000) + '1]')).reason).toBe('too-large');
    expect(badOf(settle('é'.repeat(3 * MAX_CARD_BYTES))).reason).toBe('too-large');
  });
  it('deeply nested JSON', () => {
    settle('['.repeat(100000) + ']'.repeat(100000));
    settle('{"a":'.repeat(50000) + '1' + '}'.repeat(50000));
  });
});
