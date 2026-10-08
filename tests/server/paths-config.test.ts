import { mkdtempSync, rmSync, statSync, existsSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configPath, dataDir, doneDir, ensureDirs, feedDir, lockFilePath, logFilePath,
  pidFilePath, portFilePath, statePath,
} from '../../src/paths.js';
import { createConfigReader, loadConfig, resolvePort } from '../../src/config.js';
import { fakeClock, realClock } from '../../src/clock.js';
import { ENV_HOME, ENV_PORT } from '../../src/constants/env.js';
import { DEFAULT_NOTIFY_OS, DEFAULT_NOW_PRIORITY_THRESHOLD } from '../../src/constants/config.js';
import { DEFAULT_PORT } from '../../src/constants/http.js';
import { POLL_DEFAULT_MS, POLL_MAX_MS, POLL_MIN_MS } from '../../src/constants/poll.js';

let home: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
  home = join(mkdtempSync(join(tmpdir(), 'cd-')), 'data');
  env = { [ENV_HOME]: home };
});
afterEach(() => rmSync(join(home, '..'), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

describe('paths', () => {
  it('resolves all paths under override', () => {
    expect(dataDir(env)).toBe(home);
    expect(feedDir(env)).toBe(join(home, 'feed'));
    expect(doneDir(env)).toBe(join(home, 'feed', 'alerts', '.done'));
    expect(statePath(env)).toBe(join(home, 'state.json'));
    expect(configPath(env)).toBe(join(home, 'config.json'));
    expect(pidFilePath(env)).toBe(join(home, 'daemon.pid'));
    expect(portFilePath(env)).toBe(join(home, 'daemon.port'));
    expect(logFilePath(env)).toBe(join(home, 'daemon.log'));
    expect(lockFilePath(env)).toBe(join(home, 'daemon.lock'));
  });
  it('falls back to env-paths default without override', () => {
    expect(dataDir({})).toMatch(/crontick-dashboard([\\/]Data)?$/);
  });
  it('first run creates layout, default config, no state.json', () => {
    ensureDirs(env);
    for (const d of [home, feedDir(env), join(feedDir(env), 'alerts')]) expect(statSync(d).isDirectory()).toBe(true);
    if (process.platform !== 'win32') {
      expect(statSync(home).mode & 0o777).toBe(0o700);
      expect(statSync(feedDir(env)).mode & 0o777).toBe(0o700);
    }
    expect(JSON.parse(readFileSync(configPath(env), 'utf8'))).toBeTypeOf('object');
    expect(existsSync(statePath(env))).toBe(false);
  });
  it('does not overwrite existing config', () => {
    ensureDirs(env);
    writeFileSync(configPath(env), '{"port":1234}');
    ensureDirs(env);
    expect(readFileSync(configPath(env), 'utf8')).toBe('{"port":1234}');
  });
});

describe('config', () => {
  const write = (v: unknown) => {
    ensureDirs(env);
    writeFileSync(configPath(env), typeof v === 'string' ? v : JSON.stringify(v));
  };
  const sysTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  it('defaults when file missing or empty object', () => {
    const r = loadConfig(env);
    expect(r.warnings).toEqual([]);
    expect(r.config).toEqual({
      port: DEFAULT_PORT, nowPriorityThreshold: DEFAULT_NOW_PRIORITY_THRESHOLD, pollIntervalMs: POLL_DEFAULT_MS,
      timezone: sysTz, notifications: { os: DEFAULT_NOTIFY_OS },
    });
    write({});
    expect(loadConfig(env).warnings).toEqual([]);
  });
  it('old config with retentionDefault loads silently, key ignored', () => {
    write({ port: 5000, retentionDefault: '2w' });
    const r = loadConfig(env);
    expect(r.warnings).toEqual([]);
    expect(r.config.port).toBe(5000);
    expect('retentionDefault' in r.config).toBe(false);
    write({ retentionDefault: 'forever' });
    expect(loadConfig(env).warnings).toEqual([]);
  });
  it('ensureDirs does not create archive/', () => {
    ensureDirs(env);
    expect(existsSync(join(home, 'archive'))).toBe(false);
  });
  it('ensureDirs creates feed/alerts but not feed/done or feed/alerts/.done', () => {
    ensureDirs(env);
    expect(statSync(join(home, 'feed', 'alerts')).isDirectory()).toBe(true);
    expect(existsSync(join(home, 'feed', 'done'))).toBe(false);
    expect(existsSync(doneDir(env))).toBe(false);
  });
  it('accepts valid values', () => {
    write({ port: 5000, nowPriorityThreshold: 4, pollIntervalMs: POLL_MIN_MS, timezone: 'Asia/Tokyo', notifications: { os: 'off' } });
    const r = loadConfig(env);
    expect(r.warnings).toEqual([]);
    expect(r.config).toMatchObject({ port: 5000, nowPriorityThreshold: 4, pollIntervalMs: POLL_MIN_MS, timezone: 'Asia/Tokyo', notifications: { os: 'off' } });
  });
  it.each([
    ['port', 'abc', 'port'],
    ['port', 70000, 'port'],
    ['nowPriorityThreshold', 9, 'nowPriorityThreshold'],
    ['pollIntervalMs', -5, 'pollIntervalMs'],
    ['pollIntervalMs', POLL_MIN_MS - 1, 'pollIntervalMs'],
    ['pollIntervalMs', POLL_MAX_MS + 1, 'pollIntervalMs'],
    ['timezone', 'Mars/Base', 'timezone'],
    ['notifications', { os: 'maybe' }, 'notifications.os'],
  ])('bad %s falls back with warning', (key, val, name) => {
    write({ [key]: val });
    const r = loadConfig(env);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain(name);
    expect(r.config).toMatchObject({ port: DEFAULT_PORT, nowPriorityThreshold: DEFAULT_NOW_PRIORITY_THRESHOLD, pollIntervalMs: POLL_DEFAULT_MS, timezone: sysTz, notifications: { os: DEFAULT_NOTIFY_OS } });
  });
  it('one bad field does not affect others', () => {
    write({ port: 'x', nowPriorityThreshold: 5 });
    const r = loadConfig(env);
    expect(r.config.nowPriorityThreshold).toBe(5);
    expect(r.warnings).toHaveLength(1);
  });
  it('unparseable / non-object file -> all defaults + warning', () => {
    write('{nope');
    expect(loadConfig(env).warnings).toHaveLength(1);
    write('[1]');
    expect(loadConfig(env).warnings).toHaveLength(1);
    expect(loadConfig(env).config.port).toBe(DEFAULT_PORT);
  });
  it('port precedence env > config > default', () => {
    write({ port: 5000 });
    const { config } = loadConfig(env);
    expect(resolvePort(config, env)).toBe(5000);
    expect(resolvePort(config, { ...env, [ENV_PORT]: '6000' })).toBe(6000);
    expect(resolvePort(config, { ...env, [ENV_PORT]: 'junk' })).toBe(5000);
    expect(resolvePort(loadConfig({ [ENV_HOME]: join(home, 'x') }).config, {})).toBe(DEFAULT_PORT);
  });
  it('reader reloads only when mtime changes', () => {
    write({ nowPriorityThreshold: 2 });
    const p = configPath(env);
    utimesSync(p, 1000, 1000);
    const reader = createConfigReader(env);
    expect(reader.get().config.nowPriorityThreshold).toBe(2);
    writeFileSync(p, JSON.stringify({ nowPriorityThreshold: 5 }));
    utimesSync(p, 1000, 1000);
    expect(reader.get().config.nowPriorityThreshold).toBe(2);
    utimesSync(p, 2000, 2000);
    expect(reader.get().config.nowPriorityThreshold).toBe(5);
    rmSync(p);
    expect(reader.get().config.nowPriorityThreshold).toBe(3);
  });
});

describe('clock', () => {
  it('real clock returns current time', () => {
    expect(Math.abs(realClock.now().getTime() - Date.now())).toBeLessThan(1000);
  });
  it('fake clock is settable and advanceable', () => {
    const c = fakeClock('2026-01-01T00:00:00Z');
    expect(c.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
    c.advance(1000);
    expect(c.now().toISOString()).toBe('2026-01-01T00:00:01.000Z');
    c.set(new Date('2027-01-01T00:00:00Z'));
    expect(c.now().getUTCFullYear()).toBe(2027);
  });
});
