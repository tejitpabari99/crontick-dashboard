import { describe, expect, it } from 'vitest';
import { computeSnapshot } from '../../src/compute/snapshot.js';
import type { BrokenEntry, CardEntry, NoDataEntry, OkEntry } from '../../src/feed/ingest.js';
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
  const { size, updatedAt = '2026-10-05T11:00:00Z', error = null, data = { text: id }, ...rest } = over;
  const card = {
    id, type: 'markdown', title: id, priority: 2, notify: false,
    layout: { column: 'center', order: 0, height: size ?? 'M' },
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
const snap = (cards: CardEntry[], st = state(), cfg = config, now = NOW, w?: string[]) =>
  computeSnapshot(cards, st, cfg, now, w);

describe('computeSnapshot', () => {
  it('basic shape, grid zone, data present', () => {
    const s = snap([ok('a')]);
    expect(s.serverTime).toBe(NOW.toISOString());
    expect(s.config).toEqual({ pollIntervalMs: POLL_DEFAULT_MS, nowPriorityThreshold: DEFAULT_NOW_PRIORITY_THRESHOLD });
    expect(s.zones).toEqual({ alerts: [], now: [], grid: ['a'], tray: [], hidden: [] });
    expect(s.cards.a).toMatchObject({ status: 'ok', collapsed: false, data: { text: 'a' } });
  });

  it('window: out excluded, in kept', () => {
    const show = { cron: '0 9 * * *', for: '1h' };
    const s = snap([ok('p', { show })]);
    expect(Object.keys(s.cards)).toEqual([]);
    const s2 = snap([ok('p', { show: { cron: '0 11 * * *', for: '2h' } })]);
    expect(Object.keys(s2.cards)).toEqual(['p']);
  });

  it('window: non-local timezone', () => {
    const show = { cron: '0 8 * * *', for: '1h' };
    // 12:00Z = 08:00 America/New_York (EDT)
    const ny = { ...config, timezone: 'America/New_York' };
    expect(Object.keys(snap([ok('p', { show })], state(), ny).cards)).toEqual(['p']);
    expect(Object.keys(snap([ok('p', { show })], state(), config).cards)).toEqual([]);
  });

  it('window: DST spring-forward day', () => {
    // 2026-03-08 US DST starts 02:00 -> 03:00. 9am NY = 13:00Z that day.
    const show = { cron: '0 9 * * *', for: '1h' };
    const ny = { ...config, timezone: 'America/New_York' };
    const inside = snap([ok('p', { show })], state(), ny, new Date('2026-03-08T13:30:00Z'));
    expect(Object.keys(inside.cards)).toEqual(['p']);
    const before = snap([ok('p', { show })], state(), ny, new Date('2026-03-08T14:30:00Z'));
    expect(Object.keys(before.cards)).toEqual([]);
  });

  it('error -> broken reason error, no data', () => {
    const s = snap([ok('e', { error: 'upstream down', data: { x: 1 } })]);
    expect(s.cards.e).toMatchObject({ status: 'broken', reason: 'error', message: 'upstream down' });
    expect('data' in s.cards.e!).toBe(false);
    expect(s.zones.grid).toEqual(['e']);
  });

  it('stale -> broken reason stale, no data; fresh stays ok', () => {
    const s = snap([
      ok('old', { staleAfter: '30m' }),
      ok('fresh', { staleAfter: '2h' }),
    ]);
    expect(s.cards.old).toMatchObject({ status: 'broken', reason: 'stale' });
    expect('data' in s.cards.old!).toBe(false);
    expect(s.cards.fresh).toMatchObject({ status: 'ok' });
    expect(s.cards.fresh!.data).toBeDefined();
  });

  it('malformed / schema-invalid / unknown-type from ingest -> broken without data', () => {
    const s = snap([
      broken('file:a', { reason: 'malformed-json', message: 'oops', title: 'a.json' }),
      broken('b', { id: 'b', reason: 'schema-invalid', message: 'bad' }),
      broken('file:c', { reason: 'unknown-type', message: 'dup' }),
    ]);
    expect(s.cards['file:a']).toMatchObject({ id: 'file:a', status: 'broken', reason: 'malformed-json', title: 'a.json', message: 'oops' });
    expect(s.cards.b).toMatchObject({ reason: 'schema-invalid' });
    expect(s.cards['file:c']).toMatchObject({ reason: 'unknown-type' });
    for (const c of Object.values(s.cards)) expect('data' in c).toBe(false);
  });

  it('Now promotion rules', () => {
    const show = { cron: '0 11 * * *', for: '2h' };
    const s = snap([
      ok('hi', { priority: 3, show }),
      ok('lo', { priority: 2, show }),
      ok('noshow', { priority: 5 }),
      ok('brokenhi', { priority: 4, show, error: 'x' }),
    ]);
    expect(s.zones.now).toEqual(['brokenhi', 'hi']);
    expect(s.zones.grid.sort()).toEqual(['lo', 'noshow']);
    expect(s.cards.hi!.data).toBeDefined();
  });

  it('Done ack -> tray; resets on new updatedAt; compares instants', () => {
    const show = { cron: '0 11 * * *', for: '2h' };
    const p = ok('p', { priority: 4, show });
    let s = snap([p], state({ acks: { p: '2026-10-05T11:00:00Z' } }));
    expect(s.zones).toMatchObject({ tray: ['p'], now: [], grid: [] });
    expect(s.cards.p!.data).toBeDefined();
    s = snap([p], state({ acks: { p: '2026-10-05T07:00:00-04:00' } }));
    expect(s.zones.tray).toEqual(['p']);
    s = snap([ok('p', { priority: 4, show, updatedAt: '2026-10-05T11:30:00Z' })], state({ acks: { p: '2026-10-05T11:00:00Z' } }));
    expect(s.zones).toMatchObject({ tray: [], now: ['p'] });
  });

    it('no-data entry is shown muted; goes stale from the card.json mtime', () => {
    const nd = (staleAfter?: string): NoDataEntry => ({
    status: 'no-data', key: 'n', file: 'n/data.json', dataPath: '/feed/n/data.json', viewHash: 'v',
    viewMtimeMs: Date.parse('2026-10-05T11:00:00Z'), warnings: [],
    card: { id: 'n', type: 'markdown', title: 'n', layout: { column: 'center', order: 0, height: 'auto' }, priority: 2, notify: false,
      ...(staleAfter ? { staleAfter } : {}), def: {} } as NoDataEntry['card'],
  });
  const fresh = snap([nd('2h')]);
  expect(fresh.cards.n).toMatchObject({ status: 'broken', reason: 'no-data' });
  expect('data' in fresh.cards.n!).toBe(false);
  expect(snap([nd('30m')]).cards.n).toMatchObject({ status: 'broken', reason: 'stale' });
});

  it('collapsed for panels priority <= 1 only', () => {
    const s = snap([ok('a', { priority: 1 }), ok('b', { priority: 2 })]);
    expect(s.cards.a!.collapsed).toBe(true);
    expect(s.cards.b!.collapsed).toBe(false);
  });

  it('hidden -> hidden zone only, with data', () => {
    const s = snap([ok('a'), ok('b')], state({ hidden: { a: true } }));
    expect(s.zones).toMatchObject({ grid: ['b'], hidden: ['a'] });
    expect(s.cards.a!.data).toBeDefined();
  });

  it('sorts priority desc, updatedAt desc, id asc', () => {
    const s = snap([
      ok('c', { priority: 2, updatedAt: '2026-10-05T10:00:00Z' }),
      ok('b', { priority: 2, updatedAt: '2026-10-05T11:00:00Z' }),
      ok('a', { priority: 2, updatedAt: '2026-10-05T11:00:00Z' }),
      ok('z', { priority: 4 }),
    ]);
    expect(s.zones.grid).toEqual(['z', 'a', 'b', 'c']);
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
