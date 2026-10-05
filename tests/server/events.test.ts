import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
const put = (name: string, text: string) => writeFileSync(join(feed, name), text);

function boot() {
  const state = createStateStore({ env: env(), clock });
  const warnings = createWarnings();
  const ev = createCardEvents({ state, clock, getTimezone: () => 'UTC', warnings });
  const got: { type: string; p: CardEventPayload }[] = [];
  for (const t of ['card:new', 'card:changed', 'card:removed'] as const) ev.events.on(t, (p) => got.push({ type: t, p }));
  const ing = createFeedIngest({ feedDir: feed, onChange: ev.onChange });
  return { state, warnings, ev, got, ing };
}

describe('card events', () => {
  it('fires new, changed, removed and stamps notified', async () => {
    const { state, ev, got, ing } = boot();
    put('a.json', card('a'));
    ing.rescan();
    await ev.flush();
    expect(got.map((g) => g.type)).toEqual(['card:new']);
    expect(got[0]!.p.file).toBe('a.json');
    expect(state.get().notified['a']).toBe('2026-06-01T10:00:00Z');
    put('a.json', card('a', '2026-06-01T11:00:00Z'));
    ing.processFile('a.json');
    await ev.flush();
    expect(got.map((g) => g.type)).toEqual(['card:new', 'card:changed']);
    expect(got[1]!.p.prev?.['updatedAt']).toBe('2026-06-01T10:00:00Z');
    unlinkSync(join(feed, 'a.json'));
    ing.rescan();
    await ev.flush();
    expect(got.map((g) => g.type)).toEqual(['card:new', 'card:changed', 'card:removed']);
    expect(got[2]!.p.card['id']).toBe('a');
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
    expect(second.got.map((g) => `${g.type}:${g.p.card['id']}`)).toEqual(['card:new:b']);
  });

  it('same updatedAt rewrite (server write-back) never fires', async () => {
    const { ev, got, ing } = boot();
    put('a.json', card('a'));
    ing.rescan();
    await ev.flush();
    put('a.json', card('a', '2026-06-01T10:00:00Z', { data: { text: 'edited' } }));
    ing.processFile('a.json');
    await ev.flush();
    expect(got).toHaveLength(1);
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
    unlinkSync(join(feed, 'err.json'));
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
    const snap = computeSnapshot([], state.get(), cfg, clock.now(), [...state.warnings, ...w.list()]);
    expect(snap.warnings).toEqual(['fs.watch failed again']);
  });
});
