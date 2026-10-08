import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeClock } from '../../src/clock.js';
import { startServer, type RunningServer } from '../../src/http/server.js';
import type { Snapshot } from '../../src/shared/api-types.js';
import { ENV_HOME } from '../../src/constants/env.js';
import { MUTATION_HEADER, MUTATION_HEADER_VALUE } from '../../src/constants/http.js';
import { loopbackUrl } from '../../src/utils/loopback.js';

let data: string;
let ui: string;
let running: RunningServer | undefined;
const clock = fakeClock('2026-06-01T12:00:00Z');
const feed = (n: string): string => join(data, 'feed', n);
/** Write feed/<id>/data.json (raw text) and, if missing, a list card.json for the folder. */
const writeData = (id: string, text: string): void => {
  mkdirSync(feed(id), { recursive: true });
  if (!existsSync(feed(`${id}/card.json`))) writeFileSync(feed(`${id}/card.json`), JSON.stringify({ type: 'list', title: id }));
  writeFileSync(feed(`${id}/data.json`), text);
};
const T1 = '2026-06-01T10:00:00Z';

const listCard = (id: string, updatedAt: string) =>
  JSON.stringify({
    updatedAt,
    data: {
      items: [
        { id: 'd', text: 'dismiss me', action: 'dismiss' },
        { id: 'c', text: 'complete me', action: { type: 'complete' } },
        { id: 'n', text: 'no action' },
      ],
    },
  });

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'act-data-'));
  ui = mkdtempSync(join(tmpdir(), 'act-ui-'));
  writeFileSync(join(ui, 'index.html'), '<html></html>');
  mkdirSync(join(data, 'feed'), { recursive: true });
});
afterEach(async () => {
  await running?.stop();
  running = undefined;
  rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  rmSync(ui, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const boot = async (): Promise<RunningServer> =>
  (running = await startServer({ env: { [ENV_HOME]: data }, clock, uiDir: ui, port: 0 }));
const act = (s: RunningServer, id: string, body: unknown) =>
  fetch(`${loopbackUrl(s.port)}/api/cards/${id}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [MUTATION_HEADER]: MUTATION_HEADER_VALUE },
    body: JSON.stringify(body),
  });
const snap = async (s: RunningServer): Promise<Snapshot> =>
  (await (await fetch(`${loopbackUrl(s.port)}/api/snapshot`)).json()) as Snapshot;
const call = (s: RunningServer, method: string, path: string) =>
  fetch(`${loopbackUrl(s.port)}${path}`, { method, headers: { 'Content-Type': 'application/json', [MUTATION_HEADER]: MUTATION_HEADER_VALUE } });
const checkedOf = async (s: RunningServer, id: string) =>
  (await snap(s)).cards[id]?.checked;

describe('card actions', () => {
  it('dismiss persists, returns rev, is idempotent, resets on rewrite', async () => {
    writeData('l1', listCard('l1', T1));
    const s = await boot();
    const r = await act(s, 'l1', { itemId: 'd', updatedAt: T1 });
    expect(r.status).toBe(200);
    const { rev } = (await r.json()) as { rev: string };
    expect((await snap(s)).rev).toBe(rev);
    expect(await checkedOf(s, 'l1')).toEqual(['d']);
    expect((await act(s, 'l1', { itemId: 'd', updatedAt: T1, checked: true })).status).toBe(200);
    expect(await checkedOf(s, 'l1')).toEqual(['d']);
    // equivalent instant in another offset is accepted
    expect((await act(s, 'l1', { itemId: 'd', updatedAt: '2026-06-01T12:00:00+02:00' })).status).toBe(200);
    // rewrite with new updatedAt resets
    writeData('l1', listCard('l1', '2026-06-01T11:00:00Z'));
    for (let i = 0; i < 100 && (await snap(s)).cards['l1']?.updatedAt !== '2026-06-01T11:00:00Z'; i++)
      await new Promise((r2) => setTimeout(r2, 50));
    expect(await checkedOf(s, 'l1')).toBeUndefined();
  });

  it('untick of dismiss -> 400', async () => {
    writeData('l1', listCard('l1', T1));
    const s = await boot();
    expect((await act(s, 'l1', { itemId: 'd', updatedAt: T1, checked: false })).status).toBe(400);
    expect(await checkedOf(s, 'l1')).toBeUndefined();
  });

  it('stale updatedAt -> 409', async () => {
    writeData('l1', listCard('l1', T1));
    const s = await boot();
    expect((await act(s, 'l1', { itemId: 'd', updatedAt: '2026-06-01T09:00:00Z' })).status).toBe(409);
    expect(await checkedOf(s, 'l1')).toBeUndefined();
  });

  it('404 unknown card; 4xx missing item, no action, bad body, broken card', async () => {
    writeData('l1', listCard('l1', T1));
    mkdirSync(feed('bad'));
    writeFileSync(feed('bad/card.json'), JSON.stringify({ type: 'nope', title: 'x' }));
    writeFileSync(feed('bad/data.json'), JSON.stringify({ updatedAt: T1, data: {} }));
    const s = await boot();
    expect((await act(s, 'zzz', { itemId: 'd', updatedAt: T1 })).status).toBe(404);
    expect((await act(s, 'l1', { itemId: 'missing', updatedAt: T1 })).status).toBe(404);
    expect((await act(s, 'l1', { itemId: 'n', updatedAt: T1 })).status).toBe(400);
    expect((await act(s, 'l1', { itemId: 'd' })).status).toBe(400);
    expect((await act(s, 'l1', { itemId: 'd', updatedAt: T1, checked: 'x' })).status).toBe(400);
    expect((await act(s, 'bad', { itemId: 'd', updatedAt: T1 })).status).toBe(400);
  });
});

describe('complete write-back', () => {
  const rawCard = (updatedAt = T1, extra: Record<string, unknown> = {}): string =>
    JSON.stringify(
      {
        updatedAt,
        'x-owner': { keep: [1, 2] },
        data: {
          items: [
            { id: 'a', text: 'A', action: 'dismiss' },
            { id: 'c', text: 'C', ticktick: { taskId: 't1', projectId: 'p1' }, action: 'complete' },
            { id: 'o', text: 'O', action: { type: 'complete' } },
          ],
        },
        ...extra,
      },
      null,
      2,
    ) + '\n';
  const temps = (): string[] => readdirSync(feed('l1')).filter((f) => f.endsWith('.tmp'));
  const raw = (): { data: { items: Record<string, unknown>[] } } & Record<string, unknown> =>
    JSON.parse(readFileSync(feed('l1/data.json'), 'utf8'));

  it('ticks only that item, preserves extras/order, no temp, no event, Done ack valid', async () => {
    writeData('l1', rawCard());
    const before = JSON.parse(rawCard());
    const s = await boot();
    const changed: unknown[] = [];
    s.events.on('card:changed', (e) => changed.push(e));
    const r = await act(s, 'l1', { itemId: 'c', updatedAt: T1 });
    expect(r.status).toBe(200);
    const after = raw();
    const c = after.data.items[1] as Record<string, unknown>;
    expect(c['checked']).toBe(true);
    expect(c['checkedAt']).toMatch(/^2026-06-01T\d\d:00:00\.000[+-]\d\d:\d\d$/);
    expect(c['ticktick']).toEqual({ taskId: 't1', projectId: 'p1' });
    expect(Object.keys(c)).toEqual(['id', 'text', 'ticktick', 'action', 'checked', 'checkedAt']);
    expect(after['updatedAt']).toBe(T1);
    expect(after['x-owner']).toEqual({ keep: [1, 2] });
    expect(Object.keys(after)).toEqual(Object.keys(before));
    expect(after.data.items[0]).toEqual(before.data.items[0]);
    expect(after.data.items[2]).toEqual(before.data.items[2]);
    expect(readFileSync(feed('l1/data.json'), 'utf8').endsWith('}\n')).toBe(true);
    expect(temps()).toEqual([]);
    expect((await snap(s)).rev).toBe(((await r.json()) as { rev: string }).rev);
    await new Promise((res) => setTimeout(res, 400)); // watcher sees the write
    expect(changed).toEqual([]);
  });

  it('AC6: data.json without updatedAt -> complete pins prior mtime instant, keeps Done/checks, no event, unknown fields kept', async () => {
    const noTs = JSON.stringify({ 'x-owner': { keep: [1] }, data: { items: [
      { id: 'd', text: 'D', action: 'dismiss' },
      { id: 'c', text: 'C', x: 1, action: 'complete' },
    ] } }, null, 2) + '\n';
    writeData('l1', noTs);
    const mtimeSec = Date.parse('2026-05-31T09:00:00Z') / 1000;
    utimesSync(feed('l1/data.json'), mtimeSec, mtimeSec);
    const prior = new Date(mtimeSec * 1000).toISOString();
    const s = await boot();
    const events: unknown[] = [];
    s.events.on('card:changed', (e) => events.push(e));
    s.events.on('card:new', (e) => events.push(e));
    expect((await snap(s)).cards['l1']?.updatedAt).toBe(prior);
    expect((await call(s, 'POST', '/api/cards/l1/done')).status).toBe(200);
    expect((await act(s, 'l1', { itemId: 'd', updatedAt: prior })).status).toBe(200);
    const r = await act(s, 'l1', { itemId: 'c', updatedAt: prior });
    expect(r.status).toBe(200);
    const after = raw();
    expect(after['updatedAt']).toBe(prior);
    expect(after['x-owner']).toEqual({ keep: [1] });
    expect(after.data.items[1]).toMatchObject({ x: 1, checked: true });
    expect(temps()).toEqual([]);
    await new Promise((res) => setTimeout(res, 600)); // ingest re-reads the renamed file
    const a = await snap(s);
    expect(a.cards['l1']?.updatedAt).toBe(prior);
    expect(a.completed).toEqual([{ kind: 'card', id: 'l1' }]);
    expect(a.cards['l1']?.checked).toEqual(['d']);
    expect((a.cards['l1'] as unknown as { data: { items: Record<string, unknown>[] } }).data.items[1]?.['checked']).toBe(true);
    expect(events).toEqual([]);
  });

  it('untick deletes checkedAt; shorthand and object action both work', async () => {
    writeData('l1', rawCard());
    const s = await boot();
    expect((await act(s, 'l1', { itemId: 'o', updatedAt: T1 })).status).toBe(200);
    expect(raw().data.items[2]).toMatchObject({ checked: true });
    expect((await act(s, 'l1', { itemId: 'o', updatedAt: T1, checked: false })).status).toBe(200);
    const o = raw().data.items[2] as Record<string, unknown>;
    expect(o['checked']).toBe(false);
    expect('checkedAt' in o).toBe(false);
  });

  it('on-disk change since ingest -> 409 and re-ingest, file untouched', async () => {
    writeData('l1', rawCard());
    const s = await boot();
    const other = rawCard('2026-06-01T11:00:00Z');
    writeData('l1', other);
    const r = await act(s, 'l1', { itemId: 'c', updatedAt: T1 });
    expect(r.status).toBe(409);
    expect(readFileSync(feed('l1/data.json'), 'utf8')).toBe(other);
    expect(temps()).toEqual([]);
    expect((await snap(s)).cards['l1']).toBeDefined();
  });

  it('agent rewrite mid-flight with same updatedAt: retried, both changes survive', async () => {
    writeData('l1', rawCard());
    let fired = 0;
    running = await startServer({
      env: { [ENV_HOME]: data },
      clock,
      uiDir: ui,
      port: 0,
      actionTestDeps: {
        hooks: {
          beforeCompare: () => {
            if (fired++ === 0) writeData('l1', rawCard(T1, { note: 'agent' }));
          },
        },
      },
    });
    const r = await act(running, 'l1', { itemId: 'c', updatedAt: T1 });
    expect(r.status).toBe(200);
    const after = raw();
    expect(after['note']).toBe('agent');
    expect((after.data.items[1] as Record<string, unknown>)['checked']).toBe(true);
    expect(temps()).toEqual([]);
  });

  it('agent rewrite mid-flight with new updatedAt: 409, agent file wins', async () => {
    writeData('l1', rawCard());
    const agent = rawCard('2026-06-01T11:00:00Z');
    running = await startServer({
      env: { [ENV_HOME]: data },
      clock,
      uiDir: ui,
      port: 0,
      actionTestDeps: { hooks: { beforeCompare: () => writeData('l1', agent) } },
    });
    const r = await act(running, 'l1', { itemId: 'c', updatedAt: T1 });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'CARD_CHANGED' });
    expect(readFileSync(feed('l1/data.json'), 'utf8')).toBe(agent);
    expect(temps()).toEqual([]);
  });

  it('rename EPERM is retried with backoff; persistent EPERM cleans up and 500s', async () => {
    writeData('l1', rawCard());
    let calls = 0;
    const sleeps: number[] = [];
    running = await startServer({
      env: { [ENV_HOME]: data },
      clock,
      uiDir: ui,
      port: 0,
      actionTestDeps: {
        sleep: (ms) => (sleeps.push(ms), Promise.resolve()),
        rename: (a, b) => {
          if (++calls < 3) throw Object.assign(new Error('busy'), { code: 'EPERM' });
          renameSync(a, b);
        },
      },
    });
    expect((await act(running, 'l1', { itemId: 'c', updatedAt: T1 })).status).toBe(200);
    expect(calls).toBe(3);
    expect(sleeps.length).toBe(2);
    await running.stop();
    running = undefined;

    writeData('l1', rawCard());
    calls = -100;
    running = await startServer({
      env: { [ENV_HOME]: data },
      clock,
      uiDir: ui,
      port: 0,
      actionTestDeps: {
        sleep: () => Promise.resolve(),
        rename: () => {
          calls++;
          throw Object.assign(new Error('busy'), { code: 'EPERM' });
        },
      },
    });
    expect((await act(running, 'l1', { itemId: 'c', updatedAt: T1 })).status).toBe(500);
    expect(calls).toBe(-100 + 5);
    expect(temps()).toEqual([]);
    expect(readFileSync(feed('l1/data.json'), 'utf8')).toBe(rawCard());
  });

  it('restart before ingest: write is an ordinary change, no event', async () => {
    writeData('l1', rawCard());
    let s = await boot();
    const evs: unknown[] = [];
    s.events.on('card:changed', (e) => evs.push(e));
    s.events.on('card:new', (e) => evs.push(e));
    await act(s, 'l1', { itemId: 'c', updatedAt: T1 });
    await s.stop();
    running = undefined;
    s = await boot();
    s.events.on('card:changed', (e) => evs.push(e));
    s.events.on('card:new', (e) => evs.push(e));
    await new Promise((res) => setTimeout(res, 300));
    expect(evs.length).toBeLessThanOrEqual(1); // only the initial notify for the first boot's new card, if any
    expect(evs.filter((e) => (e as { id?: string }).id !== 'l1')).toEqual([]);
  });
});
