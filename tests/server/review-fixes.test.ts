import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeClock } from '../../src/clock.js';
import { createCardEvents, type CardEventPayload } from '../../src/feed/events.js';
import { createFeedIngest } from '../../src/feed/ingest.js';
import { sameInstant } from '../../src/instant.js';
import { startServer, type RunningServer } from '../../src/http/server.js';
import { daemonStatus } from '../../src/lifecycle.js';
import { pidFilePath, portFilePath } from '../../src/paths.js';
import { createStateStore } from '../../src/state/store.js';

let data: string;
let ui: string;
let running: RunningServer | undefined;
beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'rf-data-'));
  ui = mkdtempSync(join(tmpdir(), 'rf-ui-'));
  writeFileSync(join(ui, 'index.html'), '<html></html>');
  mkdirSync(join(data, 'feed'), { recursive: true });
});
afterEach(async () => {
  await running?.stop();
  running = undefined;
  rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  rmSync(ui, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});
const env = (): NodeJS.ProcessEnv => ({ CRONTICK_DASHBOARD_HOME: data });
const card = (id: string, extra: object = {}): string =>
  JSON.stringify({ id, kind: 'panel', type: 'markdown', title: id, updatedAt: '2026-06-01T10:00:00Z', data: { text: 'hi' }, ...extra });
const waitFor = async (fn: () => boolean, ms = 3000): Promise<void> => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('sameInstant', () => {
  it('matches identical strings and equal parsed instants only', () => {
    expect(sameInstant('2026-06-01T10:00:00Z', '2026-06-01T10:00:00Z')).toBe(true);
    expect(sameInstant('2026-06-01T10:00:00Z', '2026-06-01T12:00:00+02:00')).toBe(true);
    expect(sameInstant('2026-06-01T10:00:00Z', '2026-06-01T10:00:01Z')).toBe(false);
    expect(sameInstant('garbage', 'garbage')).toBe(true);
    expect(sameInstant('garbage', 'other')).toBe(false);
    expect(sameInstant('garbage', '2026-06-01T10:00:00Z')).toBe(false);
    expect(sameInstant(undefined, 'x')).toBe(false);
    expect(sameInstant(1, 1)).toBe(false);
  });
});

describe('state store rollback', () => {
  it('restores memory when the write fails', async () => {
    let fail = true;
    const s = createStateStore({
      env: env(),
      clock: fakeClock(0),
      retryDelayMs: 1,
      renameFn: async () => {
        if (fail) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      },
    });
    await expect(s.ack('a', 'u1')).rejects.toThrow('disk full');
    expect(s.get().acks['a']).toBeUndefined();
    await expect(s.setChecks('c', 'u', ['i'])).rejects.toThrow();
    expect(s.get().checks['c']).toBeUndefined();
    fail = false;
    await s.ack('b', 'u2');
    expect(s.get().acks['b']).toBe('u2');
    expect(s.get().acks['a']).toBeUndefined();
  });
});

describe('state reconcile wiring', () => {
  it('fresh start creates no state.json', async () => {
    // out of its show window => not notified/stamped, so nothing else mutates state
    writeFileSync(join(data, 'feed', 'a.json'), card('a', { show: { cron: '0 3 * * *', for: '1h' } }));
    running = await startServer({ env: env(), clock: fakeClock('2026-06-02T12:00:00Z'), uiDir: ui, port: 0 });
    await new Promise((r) => setTimeout(r, 150));
    expect(existsSync(join(data, 'state.json'))).toBe(false);
  });

  it('records lastSeen for present ids after the startup scan when state exists', async () => {
    const s = createStateStore({ env: env() });
    await s.ack('a', '2026-06-01T10:00:00Z');
    writeFileSync(join(data, 'feed', 'a.json'), card('a'));
    running = await startServer({ env: env(), uiDir: ui, port: 0 });
    const disk = (): { lastSeen: Record<string, string> } => JSON.parse(readFileSync(join(data, 'state.json'), 'utf8'));
    await waitFor(() => disk().lastSeen['a'] !== undefined);
    expect(disk().lastSeen['a']).toBeDefined();
  });
});

describe('self-write events', () => {
  it('a write-back never fires card:changed, even if the card was not yet notified', async () => {
    const clock = fakeClock('2026-06-02T12:00:00Z'); // outside the 03:00-04:00 window
    const feed = join(data, 'feed');
    const state = createStateStore({ env: env(), clock });
    const ev = createCardEvents({ state, clock, getTimezone: () => 'UTC' });
    const got: CardEventPayload[] = [];
    for (const t of ['card:new', 'card:changed', 'card:removed'] as const) ev.events.on(t, (p) => got.push(p));
    const ing = createFeedIngest({ feedDir: feed, onChange: ev.onChange });
    writeFileSync(join(feed, 'a.json'), card('a', { show: { cron: '0 3 * * *', for: '1h' } }));
    ing.rescan();
    await ev.flush();
    expect(got).toHaveLength(0); // out of window, not stamped
    clock.set('2026-06-03T03:30:00Z'); // window now open
    const bytes = card('a', { show: { cron: '0 3 * * *', for: '1h' }, note: 'written back' });
    writeFileSync(join(feed, 'a.json'), bytes);
    ing.selfWrites.set('a.json', createHash('sha256').update(bytes).digest('hex'));
    ing.processFile('a.json');
    await ev.flush();
    expect(got).toHaveLength(0);
    expect(state.get().notified['a']).toBeUndefined();
  });
});

describe('daemonStatus with a live but unhealthy pid', () => {
  it('keeps pid/port files and reports running+unhealthy', async () => {
    const child = spawn('sleep', ['30'], { stdio: 'ignore' });
    try {
      writeFileSync(pidFilePath(env()), `${child.pid}\n`);
      writeFileSync(portFilePath(env()), '1\n'); // nothing listens there
      const st = await daemonStatus({ env: env() });
      expect(st).toMatchObject({ running: true, pid: child.pid, unhealthy: true });
      expect(existsSync(pidFilePath(env()))).toBe(true);
      expect(existsSync(portFilePath(env()))).toBe(true);
    } finally {
      child.kill('SIGKILL');
      rmSync(pidFilePath(env()), { force: true });
    }
  });
});

describe('RunningServer.config', () => {
  it('exposes the live config incl. notifications.os, honoring reload', async () => {
    running = await startServer({ env: env(), uiDir: ui, port: 0 });
    expect(running.config.get().config.notifications.os).toBe('auto');
    writeFileSync(join(data, 'config.json'), JSON.stringify({ notifications: { os: 'off' } }));
    expect(running.config.get().config.notifications.os).toBe('off');
  });
});
