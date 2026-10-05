import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const env = (): NodeJS.ProcessEnv => ({ CRONTICK_DASHBOARD_HOME: data });
const feed = (n: string): string => join(data, 'feed', n);
const card = (id: string, kind: 'panel' | 'alert', updatedAt: string) =>
  JSON.stringify({ id, kind, type: 'markdown', title: id, updatedAt, data: { text: 'hi' } });

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'e2e-data-'));
  ui = mkdtempSync(join(tmpdir(), 'e2e-ui-'));
  writeFileSync(join(ui, 'index.html'), '<html></html>');
  mkdirSync(join(data, 'feed'), { recursive: true });
});
afterEach(async () => {
  await running?.stop();
  running = undefined;
  rmSync(data, { recursive: true, force: true });
  rmSync(ui, { recursive: true, force: true });
});

const boot = async (): Promise<RunningServer> => (running = await startServer({ env: env(), clock, uiDir: ui, port: 0 }));
const call = (s: RunningServer, method: string, path: string, body?: unknown) =>
  fetch(`http://127.0.0.1:${s.port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Crontick-Dashboard': '1' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const snap = async (s: RunningServer): Promise<Snapshot> =>
  (await (await fetch(`http://127.0.0.1:${s.port}/api/snapshot`)).json()) as Snapshot;
async function until(fn: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 100 && !(await fn()); i++) await new Promise((r) => setTimeout(r, 50));
}

describe('e2e acceptance', () => {
  it('broken card over HTTP has no data', async () => {
    writeFileSync(feed('bad.json'), JSON.stringify({ id: 'bad', kind: 'panel', type: 'markdown', title: 'b', updatedAt: '2026-06-01T10:00:00Z', status: 'error', data: { secret: 'x' } }));
    writeFileSync(feed('ok.json'), card('ok', 'panel', '2026-06-01T10:00:00Z'));
    const s = await boot();
    const sn = await snap(s);
    const cards = sn.cards as unknown as Record<string, Record<string, unknown>>;
    const broken = Object.values(cards).find((c) => c['status'] === 'broken' || c['broken'] !== undefined);
    expect(broken).toBeDefined();
    expect(broken).not.toHaveProperty('data');
    expect(JSON.stringify(sn)).not.toContain('secret');
  });

  it('50 concurrent mutations over HTTP leave valid state.json with all effects', async () => {
    for (let i = 0; i < 50; i++) writeFileSync(feed(`p${i}.json`), card(`p${i}`, 'panel', '2026-06-01T10:00:00Z'));
    const s = await boot();
    const res = await Promise.all(Array.from({ length: 50 }, (_, i) => call(s, 'PUT', `/api/cards/p${i}/hidden`)));
    expect(res.every((r) => r.status === 200)).toBe(true);
    const st = JSON.parse(readFileSync(join(data, 'state.json'), 'utf8')) as { hidden: Record<string, unknown> };
    expect(Object.keys(st.hidden)).toHaveLength(50);
    expect((await snap(s)).zones.hidden).toHaveLength(50);
  });

  it('delete + recreate keeps ack; restart keeps state', async () => {
    writeFileSync(feed('p1.json'), card('p1', 'panel', '2026-06-01T10:00:00Z'));
    const s = await boot();
    expect((await call(s, 'POST', '/api/cards/p1/done')).status).toBe(200);
    rmSync(feed('p1.json'));
    await until(async () => (await snap(s)).cards['p1'] === undefined);
    writeFileSync(feed('p1.json'), card('p1', 'panel', '2026-06-01T10:00:00Z'));
    await until(async () => (await snap(s)).zones.tray.includes('p1'));
    expect((await snap(s)).zones.tray).toContain('p1');
    await s.stop();
    running = undefined;
    const s2 = await boot();
    expect((await snap(s2)).zones.tray).toContain('p1');
  });

  it('repeated alert tick is idempotent 200 after the file moved to done/', async () => {
    writeFileSync(feed('a1.json'), card('a1', 'alert', '2026-06-01T10:00:00Z'));
    const s = await boot();
    expect((await call(s, 'POST', '/api/alerts/a1/tick')).status).toBe(200);
    expect(existsSync(feed('done/a1.json'))).toBe(true);
    expect((await call(s, 'POST', '/api/alerts/a1/tick')).status).toBe(200);
    expect((await call(s, 'POST', '/api/alerts/never/tick')).status).toBe(404);
    expect((await call(s, 'POST', '/api/alerts/..%2Fstate/tick')).status).toBe(404);
  });

  it('feed write -> snapshot -> mutation -> restart', async () => {
    const s = await boot();
    expect((await snap(s)).zones.alerts).toEqual([]);
    writeFileSync(feed('p1.json'), card('p1', 'panel', '2026-06-01T10:00:00Z'));
    await until(async () => (await snap(s)).zones.grid.includes('p1'));
    expect((await call(s, 'PUT', '/api/cards/p1/hidden')).status).toBe(200);
    await s.stop();
    running = undefined;
    const s2 = await boot();
    expect((await snap(s2)).zones.hidden).toEqual(['p1']);
  });
});
