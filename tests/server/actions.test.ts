import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeClock } from '../../src/clock.js';
import { startServer, type RunningServer } from '../../src/http/server.js';
import type { Snapshot } from '../../src/shared/api-types.js';

let data: string;
let ui: string;
let running: RunningServer | undefined;
const clock = fakeClock('2026-06-01T12:00:00Z');
const feed = (n: string): string => join(data, 'feed', n);
const T1 = '2026-06-01T10:00:00Z';

const listCard = (id: string, updatedAt: string) =>
  JSON.stringify({
    id,
    kind: 'panel',
    type: 'list',
    title: id,
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
  rmSync(data, { recursive: true, force: true });
  rmSync(ui, { recursive: true, force: true });
});

const boot = async (): Promise<RunningServer> =>
  (running = await startServer({ env: { CRONTICK_DASHBOARD_HOME: data }, clock, uiDir: ui, port: 0 }));
const act = (s: RunningServer, id: string, body: unknown) =>
  fetch(`http://127.0.0.1:${s.port}/api/cards/${id}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Crontick-Dashboard': '1' },
    body: JSON.stringify(body),
  });
const snap = async (s: RunningServer): Promise<Snapshot> =>
  (await (await fetch(`http://127.0.0.1:${s.port}/api/snapshot`)).json()) as Snapshot;
const checkedOf = async (s: RunningServer, id: string) =>
  (await snap(s)).cards[id]?.checked;

describe('card actions', () => {
  it('dismiss persists, returns rev, is idempotent, resets on rewrite', async () => {
    writeFileSync(feed('l1.json'), listCard('l1', T1));
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
    writeFileSync(feed('l1.json'), listCard('l1', '2026-06-01T11:00:00Z'));
    for (let i = 0; i < 100 && (await snap(s)).cards['l1']?.updatedAt !== '2026-06-01T11:00:00Z'; i++)
      await new Promise((r2) => setTimeout(r2, 50));
    expect(await checkedOf(s, 'l1')).toBeUndefined();
  });

  it('untick of dismiss -> 400', async () => {
    writeFileSync(feed('l1.json'), listCard('l1', T1));
    const s = await boot();
    expect((await act(s, 'l1', { itemId: 'd', updatedAt: T1, checked: false })).status).toBe(400);
    expect(await checkedOf(s, 'l1')).toBeUndefined();
  });

  it('stale updatedAt -> 409', async () => {
    writeFileSync(feed('l1.json'), listCard('l1', T1));
    const s = await boot();
    expect((await act(s, 'l1', { itemId: 'd', updatedAt: '2026-06-01T09:00:00Z' })).status).toBe(409);
    expect(await checkedOf(s, 'l1')).toBeUndefined();
  });

  it('404 unknown card; 4xx missing item, no action, bad body, broken card', async () => {
    writeFileSync(feed('l1.json'), listCard('l1', T1));
    writeFileSync(feed('bad.json'), JSON.stringify({ id: 'bad', kind: 'panel', type: 'nope', title: 'x', updatedAt: T1 }));
    const s = await boot();
    expect((await act(s, 'zzz', { itemId: 'd', updatedAt: T1 })).status).toBe(404);
    expect((await act(s, 'l1', { itemId: 'missing', updatedAt: T1 })).status).toBe(404);
    expect((await act(s, 'l1', { itemId: 'n', updatedAt: T1 })).status).toBe(400);
    expect((await act(s, 'l1', { itemId: 'd' })).status).toBe(400);
    expect((await act(s, 'l1', { itemId: 'd', updatedAt: T1, checked: 'x' })).status).toBe(400);
    expect((await act(s, 'bad', { itemId: 'd', updatedAt: T1 })).status).toBe(400);
  });

  it('complete has a handler slot: 501 not implemented', async () => {
    writeFileSync(feed('l1.json'), listCard('l1', T1));
    const s = await boot();
    const r = await act(s, 'l1', { itemId: 'c', updatedAt: T1 });
    expect(r.status).toBe(501);
    expect(await r.json()).toEqual({ error: 'not implemented' });
  });
});
