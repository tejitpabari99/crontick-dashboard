import { mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { putCard } from '../helpers/feed-folder.js';
import { fakeClock } from '../../src/clock.js';
import { computeSnapshot } from '../../src/compute/snapshot.js';
import { createCardEvents, type CardEventPayload } from '../../src/feed/events.js';
import { createFeedIngest } from '../../src/feed/ingest.js';
import { createStateStore } from '../../src/state/store.js';
import { createWarnings } from '../../src/state/warnings.js';
import { ENV_HOME } from '../../src/constants/env.js';
import { DEFAULT_NOW_PRIORITY_THRESHOLD } from '../../src/constants/config.js';
import { POLL_DEFAULT_MS } from '../../src/constants/poll.js';

let feed: string;
let data: string;
const clock = fakeClock('2026-06-01T12:00:00Z');
const env = (): NodeJS.ProcessEnv => ({ [ENV_HOME]: data });
beforeEach(() => {
  feed = mkdtempSync(join(tmpdir(), 'ev-feed-'));
  data = mkdtempSync(join(tmpdir(), 'ev-data-'));
  clock.set('2026-06-01T12:00:00Z');
});
afterEach(() => {
  rmSync(feed, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const card = (id: string, updatedAt = '2026-06-01T10:00:00Z', extra: object = {}) =>
  JSON.stringify({ id, kind: 'panel', type: 'markdown', title: id, updatedAt, data: { text: 'hi' }, ...extra });
const put = (name: string, text: string) => putCard(feed, name.replace(/\.json$/, ''), text);
const drop = (name: string) => rmSync(join(feed, name.replace(/\.json$/, '')), { recursive: true, force: true });

function boot() {
  const state = createStateStore({ env: env(), clock });
  const warnings = createWarnings();
  const ev = createCardEvents({ state, clock, getTimezone: () => 'UTC', warnings });
  const got: { type: string; p: CardEventPayload }[] = [];
  for (const t of ['card:new', 'card:changed', 'card:removed'] as const) ev.events.on(t, (p) => got.push({ type: t, p }));
  const ing = createFeedIngest({ feedDir: feed, onChange: ev.onChange, onAlertChange: ev.onAlertChange });
  return { state, warnings, ev, got, ing };
}

describe('card events', () => {
  it('fires new, changed, removed and stamps notified', async () => {
    const { state, ev, got, ing } = boot();
    put('a.json', card('a'));
    ing.rescan();
    await ev.flush();
    expect(got.map((g) => g.type)).toEqual(['card:new']);
    expect(got[0]!.p.file).toBe('a/data.json');
    expect(state.get().notified['a']).toBe('2026-06-01T10:00:00Z');
    put('a.json', card('a', '2026-06-01T11:00:00Z'));
    ing.processFolder('a');
    await ev.flush();
    expect(got.map((g) => g.type)).toEqual(['card:new', 'card:changed']);
        drop('a.json');
    ing.rescan();
    await ev.flush();
    expect(got.map((g) => g.type)).toEqual(['card:new', 'card:changed', 'card:removed']);
    expect(got[2]!.p.id).toBe('a');
  });

  it('restart emits nothing for unchanged, emits for changed-while-down', async () => {
    const first = boot();
    put('a.json', card('a'));
    put('b.json', card('b'));
    first.ing.rescan();
    await first.ev.flush();
    put('b.json', card('b', '2026-06-01T11:30:00Z')); // changed while down
    const second = boot();
    second.ing.rescan();
    await second.ev.flush();
    expect(second.got.map((g) => `${g.type}:${g.p.id}`)).toEqual(['card:new:b']);
  });

  it('same updatedAt rewrite (server write-back) never fires', async () => {
    const { ev, got, ing } = boot();
    put('a.json', card('a'));
    ing.rescan();
    await ev.flush();
    put('a.json', card('a', '2026-06-01T10:00:00Z', { data: { text: 'edited' } }));
    ing.processFolder('a');
    await ev.flush();
    expect(got).toHaveLength(1);
  });

  it('card.json-only edit (contentChanged:false) never fires or re-stamps', async () => {
    const { ev, got, ing } = boot();
    put('a.json', card('a'));
    ing.rescan();
    await ev.flush();
    put('a.json', card('a', undefined, { title: 'Renamed', priority: 4 })); // view fields only; data identical
    ing.processFolder('a');
    await ev.flush();
    expect(got.map((g) => g.type)).toEqual(['card:new']);
  });

  it('never fires for broken, errored, stale, or out-of-window cards', async () => {
    const { state, ev, got, ing } = boot();
    put('bad.json', '{"id":"bad"');
    put('err.json', card('err', undefined, { error: 'boom' }));
    put('stale.json', card('stale', '2026-05-01T00:00:00Z', { staleAfter: '1h' }));
    put('win.json', card('win', undefined, { show: { cron: '0 20 * * *', for: '1h' } }));
    ing.rescan();
    ing.dispose();
    await ev.flush();
    expect(got).toEqual([]);
    expect(state.get().notified['win']).toBeUndefined();
  });

  it('removed of a broken card does not fire', async () => {
    const { ev, got, ing } = boot();
    put('err.json', card('err', undefined, { error: 'boom' }));
    ing.rescan();
    drop('err.json');
    ing.rescan();
    await ev.flush();
    expect(got).toEqual([]);
  });

  it('listener errors do not stop stamping or other listeners', async () => {
    const { state, ev, ing } = boot();
    let second = 0;
    ev.events.on('card:new', () => {
      throw new Error('x');
    });
    ev.events.on('card:new', () => void second++);
    put('a.json', card('a'));
    ing.rescan();
    await ev.flush();
    expect(second).toBe(1);
    expect(state.get().notified['a']).toBeDefined();
  });

  it('off/unsubscribe stops delivery', async () => {
    const { ev, ing } = boot();
    let n = 0;
    const off = ev.events.on('card:new', () => void n++);
    off();
    put('a.json', card('a'));
    ing.rescan();
    await ev.flush();
    expect(n).toBe(0);
  });
});

const putAlert = (name: string, body: object, mtimeSec?: number, sub = 'alerts') => {
  const dir = join(feed, sub);
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `${name}.json`);
  writeFileSync(f, JSON.stringify(body));
  if (mtimeSec !== undefined) utimesSync(f, mtimeSec, mtimeSec);
};

describe('AC1: one card:new for card.json + data.json in either order', () => {
  const view = JSON.stringify({ type: 'markdown', title: 'T', notify: true });
  const dat = JSON.stringify({ updatedAt: '2026-06-01T10:00:00Z', data: { text: 'hi' } });
  for (const order of ['card-first', 'data-first'] as const) {
    it(order, async () => {
      const { ev, got, ing } = boot();
      const dir = join(feed, 'k');
      mkdirSync(dir, { recursive: true });
      const writes: [string, string][] = [['card.json', view], ['data.json', dat]];
      if (order === 'data-first') writes.reverse();
      for (const [f, t] of writes) {
        writeFileSync(join(dir, f), t);
        ing.processFolder('k');
      }
      await ev.flush();
      expect(got.map((g) => g.type)).toEqual(['card:new']);
      expect(got[0]!.p).toMatchObject({ kind: 'panel', id: 'k', title: 'T', type: 'markdown', notify: true, file: 'k/data.json' });
    });
  }
});

describe('AC2: updatedAt / mtime dedupe', () => {
  it('new explicit updatedAt notifies once; same bytes or same updatedAt does not', async () => {
    const { ev, got, ing } = boot();
    put('a.json', card('a'));
    ing.rescan();
    await ev.flush();
    put('a.json', card('a')); // identical rewrite
    ing.processFolder('a');
    put('a.json', card('a', '2026-06-01T10:00:00Z', { data: { text: 'edited' } })); // same updatedAt, new content
    ing.processFolder('a');
    await ev.flush();
    expect(got.map((g) => g.type)).toEqual(['card:new']);
    put('a.json', card('a', '2026-06-01T11:00:00Z', { data: { text: 'edited' } }));
    ing.processFolder('a');
    await ev.flush();
    expect(got.map((g) => g.type)).toEqual(['card:new', 'card:changed']);
  });

  it('mtime-derived updatedAt: new mtime + new content notifies', async () => {
    const { ev, got, ing } = boot();
    const p = putCard(feed, 'm', JSON.stringify({ type: 'markdown', title: 'm', data: { text: 'one' } }));
    writeFileSync(p, JSON.stringify({ data: { text: 'one' } }));
    utimesSync(p, Date.parse('2026-06-01T09:00:00Z') / 1000, Date.parse('2026-06-01T09:00:00Z') / 1000);
    ing.processFolder('m');
    await ev.flush();
    writeFileSync(p, JSON.stringify({ data: { text: 'two' } }));
    utimesSync(p, Date.parse('2026-06-01T09:30:00Z') / 1000, Date.parse('2026-06-01T09:30:00Z') / 1000);
    ing.processFolder('m');
    await ev.flush();
    expect(got.map((g) => g.type)).toEqual(['card:new', 'card:changed']);
  });
});

describe('alert events', () => {
  it('new alert fires with view payload, stamps alert:<id>; rewrite with new updatedAt fires changed', async () => {
    const { state, ev, got, ing } = boot();
    putAlert('a', { title: 'Disk', text: 'full', notify: true, priority: 3, updatedAt: '2026-06-01T10:00:00Z' });
    ing.processAlert('a.json');
    await ev.flush();
    expect(got.map((g) => g.type)).toEqual(['card:new']);
    expect(got[0]!.p).toEqual({ kind: 'alert', id: 'a', title: 'Disk', priority: 3, notify: true, text: 'full', file: 'alerts/a.json' });
    expect(state.get().notified['alert:a']).toBe('2026-06-01T10:00:00Z');
    putAlert('a', { title: 'Disk', text: 'still full', notify: true, priority: 3, updatedAt: '2026-06-01T10:00:00Z' });
    ing.processAlert('a.json'); // content changed, same explicit updatedAt: deduped
    putAlert('a', { title: 'Disk', text: 'worse', notify: true, priority: 3, updatedAt: '2026-06-01T11:00:00Z' });
    ing.processAlert('a.json');
    await ev.flush();
    expect(got.map((g) => g.type)).toEqual(['card:new', 'card:changed']);
  });

  it('broken alerts and removals do not fire', async () => {
    const { ev, got, ing } = boot();
    putAlert('bad', { title: 'x', priority: 'high' });
    ing.processAlert('bad.json');
    putAlert('ok', { title: 'x', notify: true });
    ing.processAlert('ok.json');
    got.length = 0;
    rmSync(join(feed, 'alerts', 'ok.json'));
    ing.processAlert('ok.json');
    await ev.flush();
    expect(got).toEqual([]);
  });

  it('AC10: .done/ files never notify', async () => {
    const { ev, got, ing } = boot();
    putAlert('a', { title: 'Disk', notify: true });
    ing.processAlert('a.json');
    await ev.flush();
    got.length = 0;
    mkdirSync(join(feed, 'alerts', '.done'), { recursive: true });
    renameSync(join(feed, 'alerts', 'a.json'), join(feed, 'alerts', '.done', 'a.json'));
    ing.processAlert('a.json');
    ing.processCompletedAlert('a.json');
    putAlert('b', { title: 'Old', notify: true }, undefined, 'alerts/.done');
    ing.processCompletedAlert('b.json');
    ing.rescan();
    await ev.flush();
    expect(got).toEqual([]);
  });
});

describe('warnings registry', () => {
  it('set/clear and merge into snapshot', () => {
    const w = createWarnings();
    w.set('watcher', 'fs.watch failed');
    w.set('notify', 'adapter missing');
    w.set('watcher', 'fs.watch failed again');
    w.clear('notify');
    w.clear('nope');
    expect(w.list()).toEqual(['fs.watch failed again']);
    const state = createStateStore({ env: env(), clock });
    const cfg = { nowPriorityThreshold: DEFAULT_NOW_PRIORITY_THRESHOLD, pollIntervalMs: POLL_DEFAULT_MS, timezone: 'UTC' };
    const snap = computeSnapshot([], [], [], state.get(), cfg, clock.now(), [...state.warnings, ...w.list()]);
    expect(snap.warnings).toEqual(['fs.watch failed again']);
  });
});
