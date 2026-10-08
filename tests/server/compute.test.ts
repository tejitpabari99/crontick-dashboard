import { describe, expect, it } from 'vitest';
import { computeSnapshot } from '../../src/compute/snapshot.js';
import type { AlertEntry, BrokenEntry, CardEntry, CompletedAlertEntry, NoDataEntry, OkEntry } from '../../src/feed/ingest.js';
import type { StateData } from '../../src/state/store.js';
import type { DashboardConfig } from '../../src/config.js';
import type { ValidCard } from '../../src/contract/folder-validate.js';
import { DEFAULT_NOW_PRIORITY_THRESHOLD } from '../../src/constants/config.js';
import { POLL_DEFAULT_MS } from '../../src/constants/poll.js';

const config: DashboardConfig = {
  port: 1, nowPriorityThreshold: DEFAULT_NOW_PRIORITY_THRESHOLD, pollIntervalMs: POLL_DEFAULT_MS,
  timezone: 'UTC', notifications: { os: 'auto' },
};
const state = (p: Partial<StateData> = {}): StateData => ({
  version: 1, acks: {}, doneAt: {}, hidden: {}, checks: {}, notified: {}, lastSeen: {}, ...p,
});
const NOW = new Date('2026-10-05T12:00:00Z');

function ok(id: string, over: Record<string, unknown> = {}): OkEntry {
  const { updatedAt = '2026-10-05T11:00:00Z', error = null, data = { text: id }, column = 'center', order = 0, height = 'M', ...rest } = over;
  const card = {
    id, type: 'markdown', title: id, priority: 2, notify: false,
    layout: { column, order, height },
    updatedAt, updatedAtSource: 'data', error, data, def: {}, content: {}, ...rest,
  } as unknown as ValidCard;
  return {
    status: 'ok', key: id, file: `${id}/data.json`, dataPath: `/feed/${id}/data.json`,
    viewHash: 'v', dataHash: 'h', dataVersion: updatedAt as string, viewMtimeMs: 0, dataMtimeMs: 0, card, warnings: [],
  };
}
function broken(key: string, over: Partial<BrokenEntry> = {}): BrokenEntry {
  return { status: 'broken', key, file: `${key}/data.json`, id: key, viewHash: 'v', mtimeMs: 1, title: key,
    reason: 'malformed-json', message: 'bad json', ...over };
}
const nd = (id: string, over: Record<string, unknown> = {}): NoDataEntry => ({
  status: 'no-data', key: id, file: `${id}/data.json`, dataPath: `/feed/${id}/data.json`, viewHash: 'v',
  viewMtimeMs: Date.parse('2026-10-05T11:00:00Z'), warnings: [],
  card: { id, type: 'markdown', title: id, layout: { column: 'center', order: 0, height: 'auto' }, priority: 2, notify: false, def: {}, ...over } as NoDataEntry['card'],
});
const alert = (key: string, over: Record<string, unknown> = {}): AlertEntry => ({
  status: 'ok', key, file: `alerts/${key}.json`, hash: 'h', mtimeMs: 1, warnings: [],
  alert: { id: key, title: key, priority: 2, notify: false, updatedAt: '2026-10-05T11:00:00Z', updatedAtSource: 'data', raw: {}, ...over },
} as AlertEntry);
const done = (key: string, tickedAt: string): CompletedAlertEntry => ({
  key, file: `alerts/.done/${key}.json`, title: key, priority: 2, tickedAt, mtimeMs: Date.parse(tickedAt),
});
const snap = (cards: CardEntry[], st = state(), cfg = config, now = NOW, w?: string[], alerts: AlertEntry[] = [], comp: CompletedAlertEntry[] = []) =>
  computeSnapshot(cards, alerts, comp, st, cfg, now, w);
const show = { cron: '0 11 * * *', for: '2h' };

describe('computeSnapshot', () => {
  it('basic shape; card sits in its column with defaults, data present', () => {
    const s = snap([ok('a')]);
    expect(s.serverTime).toBe(NOW.toISOString());
    expect(s.config).toEqual({ pollIntervalMs: POLL_DEFAULT_MS, nowPriorityThreshold: DEFAULT_NOW_PRIORITY_THRESHOLD });
    expect(s.columns).toEqual({ left: [], center: ['a'], right: [] });
    expect([s.now, s.alerts, s.hidden, s.completed]).toEqual([[], [], [], []]);
    expect(s.cards.a).toMatchObject({ status: 'ok', collapsed: false, done: false, column: 'center', height: 'M', data: { text: 'a' } });
    expect(s.cards.a).not.toHaveProperty('doneAt');
  });

  it('AC4: columns ordered by order then id; every ViewCard has column/height/boolean collapsed+done', () => {
    const s = snap([
      ok('z', { column: 'left', order: 1 }), ok('b', { column: 'left', order: 0 }), ok('a', { column: 'left', order: 1 }),
      ok('r', { column: 'right' }), ok('c'),
      broken('bk', { layout: { column: 'right', order: -1, height: 'L' } }), nd('n', { layout: { column: 'right', order: 5, height: 'S' } }),
    ]);
    expect(s.columns).toEqual({ left: ['b', 'a', 'z'], center: ['c'], right: ['bk', 'r', 'n'] });
    for (const c of Object.values(s.cards)) {
      expect(['left', 'center', 'right']).toContain(c.column);
      expect(['S', 'M', 'L', 'auto']).toContain(c.height);
      expect(typeof c.collapsed).toBe('boolean');
      expect(typeof c.done).toBe('boolean');
    }
    expect(s.cards.bk).toMatchObject({ column: 'right', height: 'L', status: 'broken' });
  });

  it('AC4: Now-pinned card is absent from its column; low priority keeps slot collapsed; hidden excluded', () => {
    const s = snap([
      ok('hi', { priority: 3, show, column: 'left' }), ok('lo', { priority: 1, column: 'left' }), ok('h', { column: 'left' }),
    ], state({ hidden: { h: true } }));
    expect(s.now).toEqual(['hi']);
    expect(s.columns.left).toEqual(['lo']);
    expect(s.cards.lo).toMatchObject({ collapsed: true, done: false });
    expect(s.hidden).toEqual(['h']);
    expect(s.cards.hi!.data).toBeDefined();
  });

  it('AC4: no-data card has slot, no updatedAt/data, never Now; goes broken-stale from card.json mtime', () => {
    const fresh = snap([nd('n', { staleAfter: '2h', show, priority: 5 })]);
    expect(fresh.cards.n).toMatchObject({ status: 'no-data', column: 'center', height: 'auto', done: false });
    expect(fresh.cards.n).not.toHaveProperty('updatedAt');
    expect(fresh.cards.n).not.toHaveProperty('data');
    expect(fresh.columns.center).toEqual(['n']);
    expect(fresh.now).toEqual([]);
    expect(snap([nd('n', { staleAfter: '30m' })]).cards.n).toMatchObject({ status: 'broken', reason: 'stale', column: 'center' });
  });

  it('window: out excluded, in kept; timezone and DST', () => {
    expect(Object.keys(snap([ok('p', { show: { cron: '0 9 * * *', for: '1h' } })]).cards)).toEqual([]);
    expect(Object.keys(snap([ok('p', { show: { cron: '0 11 * * *', for: '2h' } })]).cards)).toEqual(['p']);
    const w8 = { cron: '0 8 * * *', for: '1h' };
    const ny = { ...config, timezone: 'America/New_York' };
    expect(Object.keys(snap([ok('p', { show: w8 })], state(), ny).cards)).toEqual(['p']);
    expect(Object.keys(snap([ok('p', { show: w8 })], state(), config).cards)).toEqual([]);
    const w9 = { cron: '0 9 * * *', for: '1h' };
    expect(Object.keys(snap([ok('p', { show: w9 })], state(), ny, new Date('2026-03-08T13:30:00Z')).cards)).toEqual(['p']);
    expect(Object.keys(snap([ok('p', { show: w9 })], state(), ny, new Date('2026-03-08T14:30:00Z')).cards)).toEqual([]);
  });

  it('error -> broken reason error, no data, keeps slot', () => {
    const s = snap([ok('e', { error: 'upstream down', data: { x: 1 }, column: 'right' })]);
    expect(s.cards.e).toMatchObject({ status: 'broken', reason: 'error', message: 'upstream down' });
    expect('data' in s.cards.e!).toBe(false);
    expect(s.columns.right).toEqual(['e']);
  });

  it('stale -> broken reason stale, no data; fresh stays ok', () => {
    const s = snap([ok('old', { staleAfter: '30m' }), ok('fresh', { staleAfter: '2h' })]);
    expect(s.cards.old).toMatchObject({ status: 'broken', reason: 'stale' });
    expect('data' in s.cards.old!).toBe(false);
    expect(s.cards.fresh).toMatchObject({ status: 'ok' });
  });

  it('ingest-broken entries show without data', () => {
    const s = snap([broken('file:a', { message: 'oops', title: 'a.json' }), broken('b', { reason: 'schema-invalid' })]);
    expect(s.cards['file:a']).toMatchObject({ status: 'broken', reason: 'malformed-json', title: 'a.json', message: 'oops', column: 'center', height: 'auto' });
    for (const c of Object.values(s.cards)) expect('data' in c).toBe(false);
  });

  it('Now promotion rules and order (priority desc, updatedAt desc, id)', () => {
    const s = snap([
      ok('hi', { priority: 3, show }), ok('lo', { priority: 2, show }), ok('noshow', { priority: 5 }),
      ok('brokenhi', { priority: 4, show, error: 'x' }),
      ok('t2', { priority: 3, show, updatedAt: '2026-10-05T11:30:00Z' }), ok('t1', { priority: 3, show, updatedAt: '2026-10-05T11:30:00Z' }),
    ]);
    expect(s.now).toEqual(['brokenhi', 't1', 't2', 'hi']);
    expect(s.columns.center.sort()).toEqual(['lo', 'noshow']);
  });

  it('AC9: Done card goes to completed with doneAt, not columns/now; resets on new updatedAt; compares instants', () => {
    const p = ok('p', { priority: 4, show });
    const st = (ack: string) => state({ acks: { p: ack }, doneAt: { p: '2026-10-05T11:45:00Z' } });
    let s = snap([p], st('2026-10-05T11:00:00Z'));
    expect(s.completed).toEqual([{ kind: 'card', id: 'p' }]);
    expect([s.now, s.columns.center]).toEqual([[], []]);
    expect(s.cards.p).toMatchObject({ done: true, doneAt: '2026-10-05T11:45:00Z' });
    expect(s.cards.p!.data).toBeDefined();
    s = snap([p], st('2026-10-05T07:00:00-04:00'));
    expect(s.completed).toHaveLength(1);
    s = snap([ok('p', { priority: 4, show, updatedAt: '2026-10-05T11:30:00Z' })], st('2026-10-05T11:00:00Z'));
    expect(s.completed).toEqual([]);
    expect(s.now).toEqual(['p']);
    expect(s.cards.p).toMatchObject({ done: false });
    expect(s.cards.p).not.toHaveProperty('doneAt');
  });

  it('AC9: hidden Done card is only in hidden; no-data card never Done', () => {
    const s = snap([ok('p'), nd('n')], state({ hidden: { p: true }, acks: { p: '2026-10-05T11:00:00Z', n: '2026-10-05T11:00:00Z' } }));
    expect(s.hidden).toEqual(['p']);
    expect(s.completed).toEqual([]);
    expect(s.columns.center).toEqual(['n']);
    expect(s.now).toEqual([]);
  });

  it('collapsed for priority <= 1 only', () => {
    const s = snap([ok('a', { priority: 1 }), ok('b', { priority: 2 })]);
    expect(s.cards.a!.collapsed).toBe(true);
    expect(s.cards.b!.collapsed).toBe(false);
  });

  it('alerts: sorted priority desc, newest, id; window honored; broken rows included; text optional', () => {
    const s = snap([], state(), config, NOW, [], [
      alert('b', { priority: 3 }), alert('a', { priority: 3 }), alert('new', { priority: 3, updatedAt: '2026-10-05T11:30:00Z' }),
      alert('top', { priority: 5, text: 'T', link: 'https://x.test' }),
      alert('out', { priority: 5, show: { cron: '0 9 * * *', for: '1h' } }),
      { status: 'broken', key: 'bad', file: 'alerts/bad.json', id: 'bad', title: 'bad', reason: 'schema-invalid', message: 'm', hash: 'h', mtimeMs: 5 },
    ]);
    expect(s.alerts).toEqual(['top', 'new', 'a', 'b', 'bad']);
    expect(s.alertItems.top).toMatchObject({ id: 'top', title: 'top', text: 'T', link: 'https://x.test', priority: 5, status: 'ok' });
    expect(s.alertItems.a).not.toHaveProperty('text');
    expect(s.alertItems.bad).toMatchObject({ status: 'broken', message: 'm' });
    expect(s.alertItems.out).toBeUndefined();
  });

  it('AC10: completed alerts limited to 7 days / newest 50, sorted desc then id, never in alerts', () => {
    const day = 86_400_000;
    const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
    const s = snap([], state(), config, NOW, [], [alert('live')], [
      done('old', at(8 * day)), done('edge', at(7 * day)), done('b', at(1000)), done('a', at(1000)), done('c', at(2000)),
    ]);
    expect(s.completed).toEqual([{ kind: 'alert', id: 'a' }, { kind: 'alert', id: 'b' }, { kind: 'alert', id: 'c' }, { kind: 'alert', id: 'edge' }]);
    expect(Object.keys(s.completedAlertItems).sort()).toEqual(['a', 'b', 'c', 'edge']);
    expect(s.completedAlertItems.a).toMatchObject({ id: 'a', title: 'a', priority: 2, tickedAt: at(1000) });
    expect(s.alerts).toEqual(['live']);
    const many = Array.from({ length: 60 }, (_, i) => done(`d${String(i).padStart(2, '0')}`, at((i + 1) * 1000)));
    const s2 = snap([], state(), config, NOW, [], [], many);
    expect(s2.completed).toHaveLength(50);
    expect(s2.completed[0]).toEqual({ kind: 'alert', id: 'd00' });
    expect(s2.completed[49]).toEqual({ kind: 'alert', id: 'd49' });
  });

  it('completed merges Done cards (uncapped) and alerts by time desc then id', () => {
    const st = state({
      acks: { c1: '2026-10-05T11:00:00Z', c2: '2026-10-05T11:00:00Z' },
      doneAt: { c1: '2026-10-05T11:50:00Z', c2: '2026-10-05T11:10:00Z' },
    });
    const s = snap([ok('c1'), ok('c2')], st, config, NOW, [], [], [done('al', '2026-10-05T11:30:00Z')]);
    expect(s.completed).toEqual([{ kind: 'card', id: 'c1' }, { kind: 'alert', id: 'al' }, { kind: 'card', id: 'c2' }]);
  });

  it('checked from state.checks only when updatedAt matches', () => {
    const st = state({ checks: { a: { updatedAt: '2026-10-05T11:00:00Z', items: ['i1'] }, b: { updatedAt: '2020-01-01T00:00:00Z', items: ['i1'] } } });
    const s = snap([ok('a'), ok('b')], st);
    expect(s.cards.a!.checked).toEqual(['i1']);
    expect(s.cards.b!.checked).toBeUndefined();
  });

  it('warnings merged; rev deterministic and content-sensitive', () => {
    const st = state({});
    const s1 = snap([ok('a')], st, config, NOW, ['w1']);
    const s2 = snap([ok('a')], st, config, new Date(NOW.getTime() + 1000), ['w1']);
    expect(s1.warnings).toEqual(['w1']);
    expect(s1.rev).toBe(s2.rev);
    expect(snap([ok('a', { title: 'x' })], st, config, NOW, ['w1']).rev).not.toBe(s1.rev);
    expect(snap([ok('a')], st, config, NOW, []).rev).not.toBe(s1.rev);
  });
});
