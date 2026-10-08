import { describe, expect, it } from 'vitest';
import {
  isCardFolderName,
  parseCardDef,
  validateAlertFile,
  validateCardFolder,
  type FolderResult,
} from '../../src/contract/index.js';

const NOW = new Date('2026-10-05T10:00:00Z');
const MT = Date.parse('2026-10-05T09:00:00Z');
const card = (o: Record<string, unknown> = {}) => JSON.stringify({ type: 'markdown', title: 'Hello', ...o });
const data = (o: Record<string, unknown> = {}) => JSON.stringify({ data: { text: 'x' }, ...o });
const run = (c: string | null, d: Parameters<typeof validateCardFolder>[0]['data'], id = 'my-card') =>
  validateCardFolder({ folderId: id, cardText: c, data: d, now: NOW });
const withData = (c: Record<string, unknown>, d: Record<string, unknown> = {}, mtimeMs = MT) =>
  run(card(c), { text: data(d), mtimeMs });

function ok(r: FolderResult) {
  if (r.status !== 'ok') throw new Error(`expected ok, got ${r.status}: ${'message' in r ? r.message : ''}`);
  return r;
}
function broken(r: FolderResult) {
  if (r.status !== 'broken') throw new Error(`expected broken, got ${r.status}`);
  return r;
}
function skipped(r: FolderResult) {
  if (r.status !== 'skipped') throw new Error(`expected skipped, got ${r.status}`);
  return r;
}

describe('isCardFolderName', () => {
  it('classifies', () => {
    expect(isCardFolderName('.done')).toBe('ignore');
    expect(isCardFolderName('.hidden')).toBe('ignore');
    expect(isCardFolderName('alerts')).toBe('reserved');
    expect(isCardFolderName('my-card')).toBe('ok');
    expect(isCardFolderName('Upper')).toBe('invalid');
    expect(isCardFolderName('con')).toBe('invalid');
    expect(isCardFolderName('x.')).toBe('invalid');
    expect(isCardFolderName('')).toBe('invalid');
  });
});

describe('parseCardDef', () => {
  it('gives data path', () => {
    const r = parseCardDef('c', card({ data: 'other.json' }));
    expect(r.status === 'ok' && r.dataPath).toBe('other.json');
    const d = parseCardDef('c', card());
    expect(d.status === 'ok' && d.dataPath).toBe('data.json');
  });
  it('skip reasons', () => {
    expect(parseCardDef('c', null)).toMatchObject({ status: 'skipped', reason: 'card-def-missing', id: 'c' });
    expect(parseCardDef('c', '{nope')).toMatchObject({ reason: 'card-def-invalid' });
    expect(parseCardDef('c', '[]')).toMatchObject({ reason: 'card-def-invalid' });
    expect(parseCardDef('c', JSON.stringify({ type: 'markdown' }))).toMatchObject({ reason: 'card-def-invalid' });
    expect(parseCardDef('alerts', card())).toMatchObject({ reason: 'reserved-id' });
    expect(parseCardDef('.dot', card())).toMatchObject({ reason: 'invalid-id' });
    expect(parseCardDef('Bad Id', card())).toMatchObject({ reason: 'invalid-id' });
  });
  it.each(['a/b.json', '../x.json', '.hidden.json', 'a\\b.json', 'a\u0000.json', 'x.txt', 'card.json', 'a'.repeat(200) + '.json'])(
    'data-path-invalid: %j',
    (p) => {
      expect(parseCardDef('c', card({ data: p }))).toMatchObject({ status: 'skipped', reason: 'data-path-invalid' });
    },
  );
  it('card.json size cap', () => {
    const r = parseCardDef('c', card({ pad: 'x'.repeat(65 * 1024) }));
    expect(r).toMatchObject({ status: 'skipped', reason: 'card-def-invalid' });
    expect(r.status === 'skipped' && r.message).toMatch(/64 KB/);
  });
  it('never throws on non-string', () => {
    expect(parseCardDef('c', 5 as unknown as string).status).toBe('skipped');
  });
});

describe('validateCardFolder outcomes', () => {
  it('ok with defaults', () => {
    const r = ok(withData({}));
    expect(r.card).toMatchObject({
      id: 'my-card',
      type: 'markdown',
      title: 'Hello',
      layout: { column: 'center', order: 0, height: 'auto' },
      priority: 2,
      notify: false,
      updatedAtSource: 'mtime',
      updatedAt: new Date(MT).toISOString(),
      error: null,
      data: { text: 'x' },
    });
    expect(r.card.def).toMatchObject({ type: 'markdown' });
    expect(r.card.content).toMatchObject({ data: { text: 'x' } });
    expect(r.warnings).toEqual([]);
  });
  it('carries show and staleAfter, ignores size/retention/kind as extras', () => {
    const r = ok(withData({ show: { cron: '0 9 * * *', for: '1h' }, staleAfter: '30m', size: 'L', retention: '7d', kind: 'panel' }));
    expect(r.card.show).toMatchObject({ cron: '0 9 * * *' });
    expect(r.card.staleAfter).toBe('30m');
    expect(r.card.def).toMatchObject({ size: 'L', kind: 'panel' });
  });
  it('no-data', () => {
    const r = run(card({ priority: 4 }), { absent: true });
    expect(r.status).toBe('no-data');
    if (r.status === 'no-data') expect(r.card).toMatchObject({ id: 'my-card', priority: 4, layout: { column: 'center' } });
  });
  it('skipped passes through', () => {
    expect(skipped(run(null, { absent: true })).reason).toBe('card-def-missing');
    expect(skipped(run(card(), { absent: true }, 'alerts')).reason).toBe('reserved-id');
    expect(skipped(run(card(), { absent: true }, '.x')).reason).toBe('invalid-id');
    expect(skipped(run(card({ data: '../x.json' }), { absent: true })).reason).toBe('data-path-invalid');
    expect(skipped(run('{', { absent: true })).reason).toBe('card-def-invalid');
  });
  it('unknown type -> broken with def, even with no data', () => {
    const r = broken(run(card({ type: 'nope', layout: { column: 'left' } }), { absent: true }));
    expect(r.reason).toBe('unknown-type');
    expect(r.id).toBe('my-card');
    expect(r.def?.layout.column).toBe('left');
  });
  it('invalid data -> broken with def', () => {
    const r = broken(withData({ layout: { column: 'right' } }, { data: { text: 5 } }));
    expect(r.reason).toBe('schema-invalid');
    expect(r.def?.layout.column).toBe('right');
    expect(r.issues[0]!.path).toMatch(/^\/data/);
    expect(broken(run(card(), { text: '{}', mtimeMs: MT })).reason).toBe('schema-invalid');
  });
  it('data text problems -> broken with def', () => {
    expect(broken(run(card(), { text: '{bad', mtimeMs: MT })).reason).toBe('malformed-json');
    expect(broken(run(card(), { text: '', mtimeMs: MT })).reason).toBe('malformed-json');
    expect(broken(run(card(), { text: '[1]', mtimeMs: MT })).reason).toBe('not-object');
    const u = broken(run(card(), { unreadable: 'EACCES' }));
    expect(u.reason).toBe('unreadable');
    expect(u.def).toBeDefined();
  });
  it('error set: missing/invalid data is ok and payload not validated', () => {
    const a = ok(run(card(), { text: JSON.stringify({ error: 'fetch failed' }), mtimeMs: MT }));
    expect(a.card.error).toBe('fetch failed');
    expect(a.card.data).toBeUndefined();
    const b = ok(withData({}, { error: 'boom', data: { text: 5 } }));
    expect(b.card.error).toBe('boom');
    expect(b.card.data).toBeUndefined();
    expect(ok(withData({}, { error: '' })).card.error).toBeNull();
  });
});

describe('size caps, BOM, unreadable', () => {
  it('data cap is 1 MB', () => {
    const r = broken(run(card(), { text: data({ pad: 'x'.repeat(1024 * 1024) }), mtimeMs: MT }));
    expect(r.reason).toBe('too-large');
    expect(r.def).toBeDefined();
  });
  it('BOM stripped in all files', () => {
    expect(ok(run('﻿' + card(), { text: '﻿' + data(), mtimeMs: MT })).card.title).toBe('Hello');
    const a = validateAlertFile({ name: 'a.json', text: '﻿{"title":"t"}', mtimeMs: MT, now: NOW });
    expect(a.status).toBe('ok');
  });
  it('FFFD and lone surrogate unreadable', () => {
    expect(broken(run(card(), { text: '{"a":"�"}', mtimeMs: MT })).reason).toBe('unreadable');
    expect(broken(run(card(), { text: '{"a":"\uD800"}', mtimeMs: MT })).reason).toBe('unreadable');
    expect(skipped(run('{"a":"�"}', { absent: true })).reason).toBe('card-def-invalid');
  });
});

describe('priority and updatedAt', () => {
  it('priority precedence data > card > 2', () => {
    expect(ok(withData({ priority: 4 }, { priority: 1 })).card.priority).toBe(1);
    expect(ok(withData({ priority: 4 })).card.priority).toBe(4);
    expect(ok(withData({}, { priority: 0 })).card.priority).toBe(0);
    expect(ok(withData({})).card.priority).toBe(2);
  });
  it('updatedAt from data wins; else mtime', () => {
    const d = ok(withData({}, { updatedAt: '2026-10-05T08:00:00Z' }));
    expect(d.card).toMatchObject({ updatedAt: '2026-10-05T08:00:00Z', updatedAtSource: 'data' });
    expect(ok(withData({})).card.updatedAtSource).toBe('mtime');
  });
  it('skew warning for data source, not clamped', () => {
    const r = ok(withData({}, { updatedAt: '2026-10-05T11:00:00Z' }));
    expect(r.warnings.join()).toMatch(/updatedAt is more than 5 minutes in the future/);
    expect(r.card.updatedAt).toBe('2026-10-05T11:00:00Z');
  });
  it('skew warning for mtime source', () => {
    const r = ok(withData({}, {}, NOW.getTime() + 3_600_000));
    expect(r.warnings.join()).toMatch(/file mtime is more than 5 minutes in the future/);
    expect(r.card.updatedAtSource).toBe('mtime');
  });
  it('within tolerance: no warning', () => {
    expect(ok(withData({}, {}, NOW.getTime() + 60_000)).warnings).toEqual([]);
  });
});

describe('extras and stray id', () => {
  it('unknown and x- keys preserved in raw objects', () => {
    const r = ok(withData({ 'x-a': 1, span: 2 }, { 'x-b': 3, extra: true }));
    expect(r.card.def).toMatchObject({ 'x-a': 1, span: 2 });
    expect(r.card.content).toMatchObject({ 'x-b': 3, extra: true });
  });
  it('stray id ignored with warning; folder name wins', () => {
    const r = ok(withData({ id: 'other' }, { id: 'zzz' }));
    expect(r.card.id).toBe('my-card');
    expect(r.warnings.filter((w) => w.includes('"id"'))).toHaveLength(2);
  });
  it('custom data file name used in messages', () => {
    const r = broken(run(card({ data: 'feed.json' }), { text: '{bad', mtimeMs: MT }));
    expect(r.message).toMatch(/feed\.json/);
  });
});

describe('validateAlertFile', () => {
  const alert = (o: Record<string, unknown>, name = 'deploy-failed.json') =>
    validateAlertFile({ name, text: JSON.stringify(o), mtimeMs: MT, now: NOW });
  it('ok without text; id is file stem; defaults', () => {
    const r = alert({ title: 'Deploy failed' });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.alert).toMatchObject({ id: 'deploy-failed', title: 'Deploy failed', priority: 2, notify: false, updatedAtSource: 'mtime' });
      expect(r.alert.text).toBeUndefined();
    }
  });
  it('text and link kept', () => {
    const r = alert({ title: 't', text: 'hi', link: 'https://x.test', priority: 5, updatedAt: '2026-10-05T08:00:00Z' });
    expect(r).toMatchObject({ status: 'ok', alert: { text: 'hi', link: 'https://x.test', priority: 5, updatedAtSource: 'data' } });
  });
  it('broken: long/multiline text, missing title', () => {
    for (const o of [{ title: 't', text: 'x'.repeat(201) }, { title: 't', text: 'a\nb' }, { title: 't', text: 'a b' }, { text: 'x' }]) {
      expect(alert(o)).toMatchObject({ status: 'broken', reason: 'schema-invalid', id: 'deploy-failed' });
    }
  });
  it('.done files and paths accepted', () => {
    expect(alert({ title: 't' }, '.done/old.json')).toMatchObject({ status: 'ok', alert: { id: 'old' } });
  });
  it('size cap 16 KB, bad names, text problems', () => {
    expect(alert({ title: 't', pad: 'x'.repeat(17 * 1024) })).toMatchObject({ reason: 'too-large' });
    expect(alert({ title: 't' }, 'Bad Name.json')).toMatchObject({ status: 'broken' });
    expect(alert({ title: 't' }, 'a.txt')).toMatchObject({ status: 'broken' });
    expect(validateAlertFile({ name: 'a.json', text: '{', mtimeMs: MT })).toMatchObject({ reason: 'malformed-json' });
    expect(validateAlertFile({ name: 'a.json', text: '1', mtimeMs: MT })).toMatchObject({ reason: 'not-object' });
  });
  it('skew warning both sources; stray id', () => {
    expect((alert({ title: 't', updatedAt: '2026-10-05T12:00:00Z' }) as { warnings: string[] }).warnings.join()).toMatch(/updatedAt is more/);
    const m = validateAlertFile({ name: 'a.json', text: '{"title":"t","id":"q"}', mtimeMs: NOW.getTime() + 3_600_000, now: NOW });
    expect((m as { warnings: string[] }).warnings.join()).toMatch(/file mtime is more[\s\S]*|"id"/);
    expect((m as { warnings: string[] }).warnings).toHaveLength(2);
  });
});
