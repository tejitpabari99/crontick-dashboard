import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
const env = (): NodeJS.ProcessEnv => ({ [ENV_HOME]: data });
const feed = (n: string): string => join(data, 'feed', n);

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
const snap = async (s: RunningServer): Promise<Snapshot> =>
  (await (await fetch(`${loopbackUrl(s.port)}/api/snapshot`)).json()) as Snapshot;

describe('mutations', () => {
  it('tick moves alert to done/, returns rev, is idempotent-ish, rewrite is fresh', async () => {
    writeFileSync(feed('a1.json'), card('a1', 'alert', '2026-06-01T10:00:00Z'));
    const s = await boot();
    expect((await snap(s)).zones.alerts).toEqual(['a1']);
    const r = await call(s, 'POST', '/api/alerts/a1/tick');
    expect(r.status).toBe(200);
    const { rev } = (await r.json()) as { rev: string };
    const after = await snap(s);
    expect(after.rev).toBe(rev);
    expect(after.zones.alerts).toEqual([]);
    expect(existsSync(feed('a1.json'))).toBe(false);
    expect(existsSync(feed('done/a1.json'))).toBe(true);
    // rewrite same id -> fresh card
    writeFileSync(feed('a1.json'), card('a1', 'alert', '2026-06-01T11:00:00Z'));
    for (let i = 0; i < 100 && (await snap(s)).zones.alerts.length === 0; i++) await new Promise((r2) => setTimeout(r2, 50));
    expect((await snap(s)).zones.alerts).toEqual(['a1']);
    // collision in done/ gets a suffix
    const r3 = await call(s, 'POST', '/api/alerts/a1/tick');
    expect(r3.status).toBe(200);
    const done = readdirSync(feed('done'));
    expect(done).toHaveLength(2);
    expect(done.some((f) => /^a1-\d+\.json$/.test(f))).toBe(true);
  });

  it('tick: file already gone -> 200; non-alert -> 400; unknown -> 404', async () => {
    writeFileSync(feed('a1.json'), card('a1', 'alert', '2026-06-01T10:00:00Z'));
    writeFileSync(feed('p1.json'), card('p1', 'panel', '2026-06-01T10:00:00Z'));
    const s = await boot();
    rmSync(feed('a1.json'));
    expect((await call(s, 'POST', '/api/alerts/a1/tick')).status).toBe(200);
    expect((await call(s, 'POST', '/api/alerts/p1/tick')).status).toBe(400);
    expect((await call(s, 'POST', '/api/alerts/nope/tick')).status).toBe(404);
    expect((await call(s, 'POST', '/api/alerts/..%2F..%2Fstate/tick')).status).toBe(404);
  });

  it('done ack resets on new updatedAt; undone', async () => {
    writeFileSync(feed('p1.json'), card('p1', 'panel', '2026-06-01T10:00:00Z'));
    const s = await boot();
    const r = await call(s, 'POST', '/api/cards/p1/done');
    expect(r.status).toBe(200);
    const { rev } = (await r.json()) as { rev: string };
    const a = await snap(s);
    expect(a.rev).toBe(rev);
    expect(a.zones.tray).toEqual(['p1']);
    expect((await call(s, 'DELETE', '/api/cards/p1/done')).status).toBe(200);
    expect((await snap(s)).zones.tray).toEqual([]);
    await call(s, 'POST', '/api/cards/p1/done');
    writeFileSync(feed('p1.json'), card('p1', 'panel', '2026-06-01T11:00:00Z'));
    for (let i = 0; i < 100 && (await snap(s)).cards['p1']?.updatedAt !== '2026-06-01T11:00:00Z'; i++)
      await new Promise((r2) => setTimeout(r2, 50));
    expect((await snap(s)).zones.tray).toEqual([]);
    expect((await call(s, 'POST', '/api/cards/nope/done')).status).toBe(404);
    expect((await call(s, 'DELETE', '/api/cards/nope/done')).status).toBe(404);
  });

  it('hide/unhide persist across restart; validation', async () => {
    writeFileSync(feed('p1.json'), card('p1', 'panel', '2026-06-01T10:00:00Z'));
    let s = await boot();
    expect((await call(s, 'PUT', '/api/cards/p1/hidden')).status).toBe(200);
    expect((await call(s, 'PUT', '/api/cards/nope/hidden')).status).toBe(404);
    await running!.stop();
    s = await boot();
    const a = await snap(s);
    expect(a.zones.hidden).toEqual(['p1']);
    expect((await call(s, 'DELETE', '/api/cards/p1/hidden')).status).toBe(200);
    await running!.stop();
    s = await boot();
    expect((await snap(s)).zones.hidden).toEqual([]);
    expect(readFileSync(join(data, 'state.json'), 'utf8')).toContain('"version": 1');
  });

  it('write failure -> 500 INTERNAL with a fixed message (no raw error text)', async () => {
    writeFileSync(feed('p1.json'), card('p1', 'panel', '2026-06-01T10:00:00Z'));
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
