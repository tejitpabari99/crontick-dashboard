import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { daemonStart, daemonStatus, daemonStop, runForeground } from '../../src/lifecycle.js';
import { isPidAlive } from '../../src/pid.js';
import { lockFilePath, logFilePath, pidFilePath, portFilePath } from '../../src/paths.js';
import { ENV_HOME, ENV_PORT, ENV_UI_DIR } from '../../src/constants/env.js';
import { loopbackUrl } from '../../src/utils/loopback.js';

let data: string;
let ui: string;
let port = 47900;
let env: NodeJS.ProcessEnv;
const entry = join(process.cwd(), 'src/server/index.ts');
// The daemon runs from TS source via tsx, so a cold start is CPU-bound (transform of the whole server graph).
// Measured: ~0.6s idle, but >20s when the machine is saturated (e.g. the full parallel vitest run), so the
// startup budget is generous; a real startup failure still fails fast (child exit) or at this bound.
const STARTUP_MS = 90_000;
const TEST_MS = STARTUP_MS + 30_000;
const opts = () => ({ env, serverEntry: entry, nodeArgs: ['--import', 'tsx'], startupTimeoutMs: STARTUP_MS, stopTimeoutMs: 5_000 });

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'lc-data-'));
  ui = mkdtempSync(join(tmpdir(), 'lc-ui-'));
  writeFileSync(join(ui, 'index.html'), '<html>SPA</html>');
  port += 1;
  env = { ...process.env, [ENV_HOME]: data, [ENV_PORT]: String(port), [ENV_UI_DIR]: ui };
});
afterEach(async () => {
  const pid = Number.parseInt(existsSync(pidFilePath(env)) ? readFileSync(pidFilePath(env), 'utf8') : '', 10);
  if (Number.isInteger(pid) && pid !== process.pid && isPidAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone */
    }
    for (let i = 0; i < 100 && isPidAlive(pid); i++) await new Promise((r) => setTimeout(r, 20));
  }
  rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  rmSync(ui, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('daemon lifecycle', () => {
  it('start / status / stop cycle cleans port and pid files', async () => {
    expect((await daemonStatus({ env })).running).toBe(false);
    const r = await daemonStart(opts());
    expect(r.alreadyRunning).toBe(false);
    expect(r.url).toBe(`${loopbackUrl(port)}`);
    expect(existsSync(logFilePath(env))).toBe(true);
    expect(existsSync(lockFilePath(env))).toBe(false);
    const st = await daemonStatus({ env });
    expect(st).toMatchObject({ running: true, pid: r.pid, url: r.url, dataDir: data });
    expect((await fetch(`${r.url}/api/health`)).ok).toBe(true);

    const stop = await daemonStop(opts());
    expect(stop).toMatchObject({ stopped: true, pid: r.pid, mode: 'graceful' });
    expect(isPidAlive(r.pid)).toBe(false);
    expect(existsSync(portFilePath(env))).toBe(false);
    expect(existsSync(pidFilePath(env))).toBe(false);
    expect((await daemonStatus({ env })).running).toBe(false);
  }, TEST_MS);

  it('start is idempotent and concurrent starts yield one process', async () => {
    const [a, b] = await Promise.all([daemonStart(opts()), daemonStart(opts())]);
    expect(a.pid).toBe(b.pid);
    expect([a.alreadyRunning, b.alreadyRunning].filter(Boolean)).toHaveLength(1);
    const c = await daemonStart(opts());
    expect(c).toMatchObject({ alreadyRunning: true, pid: a.pid });
    await daemonStop(opts());
  }, TEST_MS);

  it('stop when not running reports already-stopped', async () => {
    expect(await daemonStop(opts())).toMatchObject({ stopped: false, running: false, mode: 'already-stopped' });
  });

  it('recovers from a stale pid/port file and a stale lock', async () => {
    await daemonStatus({ env }); // no-op
    writeFileSync(pidFilePath(env), '999999\n');
    writeFileSync(portFilePath(env), `${port}\n`);
    writeFileSync(lockFilePath(env), JSON.stringify({ pid: 999999, at: Date.now() }));
    expect(await daemonStatus({ env })).toMatchObject({ running: false, stale: true });
    expect(existsSync(pidFilePath(env))).toBe(false);
    expect(existsSync(portFilePath(env))).toBe(false);
    writeFileSync(pidFilePath(env), '999999\n');
    writeFileSync(lockFilePath(env), JSON.stringify({ pid: 999999, at: Date.now() }));
    const r = await daemonStart(opts());
    expect(r.alreadyRunning).toBe(false);
    expect(isPidAlive(r.pid)).toBe(true);
    await daemonStop(opts());
  }, TEST_MS);

  it('a second server on the same data dir refuses to start', async () => {
    const r = await daemonStart(opts());
    const { startServer } = await import('../../src/http/server.js');
    await expect(startServer({ env, uiDir: ui, port: 0 })).rejects.toThrow(/ALREADY_RUNNING/);
    expect(readFileSync(pidFilePath(env), 'utf8').trim()).toBe(String(r.pid));
    await daemonStop(opts());
  }, TEST_MS);

  it('foreground run refuses when a daemon owns the data dir and returns its URL', async () => {
    const r = await daemonStart(opts());
    const fg = await runForeground({ env, uiDir: ui });
    expect(fg).toEqual({ started: false, url: r.url, pid: r.pid });
    await daemonStop(opts());
  }, TEST_MS);

  it('foreground run starts a server when none runs', async () => {
    const fg = await runForeground({ env, uiDir: ui });
    expect(fg.started).toBe(true);
    if (!fg.started) return;
    try {
      expect((await daemonStatus({ env })).running).toBe(true);
    } finally {
      await fg.server.stop();
    }
    expect(existsSync(pidFilePath(env))).toBe(false);
  });

  it('start failure reports the log path', async () => {
    await expect(daemonStart({ ...opts(), serverEntry: join(data, 'missing.js') })).rejects.toThrow(/NOT_BUILT/);
  });
});
