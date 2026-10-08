import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeClock } from '../../src/clock.js';
import { putCard } from '../helpers/feed-folder.js';
import { startServer, type RunningServer } from '../../src/http/server.js';
import type { Snapshot } from '../../src/shared/api-types.js';
import { ENV_HOME } from '../../src/constants/env.js';
import { MUTATION_HEADER, MUTATION_HEADER_VALUE } from '../../src/constants/http.js';
import { loopbackUrl } from '../../src/utils/loopback.js';

let data: string;
let ui: string;
let running: RunningServer | undefined;
const clock = fakeClock('2026-06-01T12:00:00Z');
const env = (): NodeJS.ProcessEnv => ({ [ENV_HOME]: data });
const put = (id: string, text: string): void => void putCard(join(data, 'feed'), id, text);

const card = (id: string, kind: 'panel' | 'alert', updatedAt: string) =>
  JSON.stringify({ id, kind, type: 'markdown', title: id, updatedAt, data: { text: 'hi' } });

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'mut-data-'));
  ui = mkdtempSync(join(tmpdir(), 'mut-ui-'));
  writeFileSync(join(ui, 'index.html'), '<html></html>');
  mkdirSync(join(data, 'feed'), { recursive: true });
});
afterEach(async () => {
  await running?.stop();
  running = undefined;
  rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  rmSync(ui, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const boot = async (): Promise<RunningServer> => (running = await startServer({ env: env(), clock, uiDir: ui, port: 0 }));
const call = (s: RunningServer, method: string, path: string, body?: unknown) =>
  fetch(`${loopbackUrl(s.port)}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', [MUTATION_HEADER]: MUTATION_HEADER_VALUE },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
async function until(fn: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 100 && !(await fn()); i++) await new Promise((r) => setTimeout(r, 50));
}
const snap = async (s: RunningServer): Promise<Snapshot> =>
  (await (await fetch(`${loopbackUrl(s.port)}/api/snapshot`)).json()) as Snapshot;

describe('mutations', () => {
  const putAlert = (id: string, extra: object = {}): void => {
    mkdirSync(join(data, 'feed', 'alerts'), { recursive: true });
    writeFileSync(join(data, 'feed', 'alerts', `${id}.json`), JSON.stringify({ title: id, ...extra }));
  };

  it('tick moves alert to .done/ (text-less ok), sets tickedAt = now, idempotent, survives restart', async () => {
    putAlert('a1');
    const s = await boot();
    await until(async () => (await snap(s)).alerts.length === 1);
    expect((await snap(s)).alerts).toEqual(['a1']);
    const r = await call(s, 'POST', '/api/alerts/a1/tick');
    expect(r.status).toBe(200);
    expect(typeof ((await r.json()) as { rev: string }).rev).toBe('string');
    expect(existsSync(join(data, 'feed', 'alerts', 'a1.json'))).toBe(false);
    const moved = join(data, 'feed', 'alerts', '.done', 'a1.json');
    expect(statSync(moved).mtimeMs).toBe(clock.now().getTime());
    const sn = await snap(s);
    expect(sn.alerts).toEqual([]);
    expect(sn.completedAlertItems['a1']).toMatchObject({ id: 'a1', title: 'a1', tickedAt: clock.now().toISOString() });
    expect(sn.completedAlertItems['a1']).not.toHaveProperty('text');
    expect(sn.completed).toContainEqual({ kind: 'alert', id: 'a1' });
    expect((await call(s, 'POST', '/api/alerts/a1/tick')).status).toBe(200); // idempotent
    expect(existsSync(moved)).toBe(true);
    await s.stop();
    running = undefined;
    const s2 = await boot();
    const sn2 = await snap(s2);
    expect(sn2.alerts).toEqual([]);
    expect(sn2.completedAlertItems['a1']?.tickedAt).toBe(clock.now().toISOString());
  });

  it('tick of a re-created alert with the same id suffixes the file and lists both', async () => {
    putAlert('a1');
    const s = await boot();
    await until(async () => (await snap(s)).alerts.length === 1);
    expect((await call(s, 'POST', '/api/alerts/a1/tick')).status).toBe(200);
    putAlert('a1', { text: 'again' });
    await until(async () => (await snap(s)).alerts.length === 1);
    expect((await call(s, 'POST', '/api/alerts/a1/tick')).status).toBe(200);
    const stamp = clock.now().getTime();
    expect(existsSync(join(data, 'feed', 'alerts', '.done', `a1-${stamp}.json`))).toBe(true);
    const sn = await snap(s);
    expect(Object.keys(sn.completedAlertItems).sort()).toEqual(['a1', `a1-${stamp}`]);
  });

  it('reopen: done card leaves its slot, DELETE done returns it and clears doneAt', async () => {
    put('p1', card('p1', 'panel', '2026-06-01T10:00:00Z'));
    const s = await boot();
    await until(async () => (await snap(s)).columns.center.includes('p1'));
    expect((await call(s, 'POST', '/api/cards/p1/done')).status).toBe(200);
    let sn = await snap(s);
    expect(sn.columns.center).not.toContain('p1');
    expect(sn.cards['p1']).toMatchObject({ done: true, doneAt: clock.now().toISOString() });
    expect(sn.completed).toContainEqual({ kind: 'card', id: 'p1' });
    expect((await call(s, 'DELETE', '/api/cards/p1/done')).status).toBe(200);
    sn = await snap(s);
    expect(sn.columns.center).toContain('p1');
    expect(sn.cards['p1']).not.toHaveProperty('doneAt');
    expect(sn.completed).toEqual([]);
  });

  it('hide is cards-only: alert id -> 404', async () => {
    putAlert('a1');
    const s = await boot();
    expect((await call(s, 'PUT', '/api/cards/a1/hidden')).status).toBe(404);
  });

  it('tick: card id -> 400 (not an alert); unknown -> 404', async () => {
    put('p1', card('p1', 'panel', '2026-06-01T10:00:00Z'));
    const s = await boot();
    expect((await call(s, 'POST', '/api/alerts/p1/tick')).status).toBe(400);
    expect((await call(s, 'POST', '/api/alerts/nope/tick')).status).toBe(404);
    expect((await call(s, 'POST', '/api/alerts/.hidden/tick')).status).toBe(404);
    expect((await call(s, 'POST', '/api/alerts/..%2F..%2Fstate/tick')).status).toBe(404);
  });

  it('done ack resets on new updatedAt; undone', async () => {
    put('p1', card('p1', 'panel', '2026-06-01T10:00:00Z'));
    const s = await boot();
    const r = await call(s, 'POST', '/api/cards/p1/done');
    expect(r.status).toBe(200);
    const { rev } = (await r.json()) as { rev: string };
    const a = await snap(s);
    expect(a.rev).toBe(rev);
    expect(a.completed).toEqual([{ kind: 'card', id: 'p1' }]);
    expect((await call(s, 'DELETE', '/api/cards/p1/done')).status).toBe(200);
    expect((await snap(s)).completed).toEqual([]);
    await call(s, 'POST', '/api/cards/p1/done');
    put('p1', card('p1', 'panel', '2026-06-01T11:00:00Z'));
    for (let i = 0; i < 100 && (await snap(s)).cards['p1']?.updatedAt !== '2026-06-01T11:00:00Z'; i++)
      await new Promise((r2) => setTimeout(r2, 50));
    expect((await snap(s)).completed).toEqual([]);
    expect((await call(s, 'POST', '/api/cards/nope/done')).status).toBe(404);
    expect((await call(s, 'DELETE', '/api/cards/nope/done')).status).toBe(404);
  });

  it('hide/unhide persist across restart; validation', async () => {
    put('p1', card('p1', 'panel', '2026-06-01T10:00:00Z'));
    let s = await boot();
    expect((await call(s, 'PUT', '/api/cards/p1/hidden')).status).toBe(200);
    expect((await call(s, 'PUT', '/api/cards/nope/hidden')).status).toBe(404);
    await running!.stop();
    s = await boot();
    const a = await snap(s);
    expect(a.hidden).toEqual(['p1']);
    expect((await call(s, 'DELETE', '/api/cards/p1/hidden')).status).toBe(200);
    await running!.stop();
    s = await boot();
    expect((await snap(s)).hidden).toEqual([]);
    expect(readFileSync(join(data, 'state.json'), 'utf8')).toContain('"version": 1');
  });

  it('write failure -> 500 INTERNAL with a fixed message (no raw error text)', async () => {
    put('p1', card('p1', 'panel', '2026-06-01T10:00:00Z'));
    const s = await boot();
    await call(s, 'PUT', '/api/cards/p1/hidden');
    // make state.json.tmp unwritable: a directory in its place
    mkdirSync(join(data, 'state.json.tmp'));
    const r = await call(s, 'DELETE', '/api/cards/p1/hidden');
    expect(r.status).toBe(500);
    const body = (await r.json()) as { error: string; code: string };
    expect(body.code).toBe('INTERNAL');
    expect(body.error).not.toMatch(/EISDIR|EEXIST|state\.json|\/tmp/);
  });
});

describe('startup schema sync', () => {
  it('calls syncSchemas once with the env', async () => {
    const calls: NodeJS.ProcessEnv[] = [];
    running = await startServer({
      env: env(), clock, uiDir: ui, port: 0,
      syncSchemas: (e) => (calls.push(e), { synced: [], unchanged: [], warnings: [] }),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(env());
  });

  it('a throwing syncSchemas is logged and does not stop the server', async () => {
    const warns: string[] = [];
    running = await startServer({
      env: env(), clock, uiDir: ui, port: 0,
      logger: { info: () => {}, warn: (m) => void warns.push(m) },
      syncSchemas: () => { throw new Error('boom'); },
    });
    expect((await fetch(`${loopbackUrl(running.port)}/api/health`)).status).toBe(200);
    expect(warns.some((w) => w.includes('boom'))).toBe(true);
  });
});
