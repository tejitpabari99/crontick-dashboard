import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeClock } from '../../src/clock.js';
import { ENV_HOME } from '../../src/constants/env.js';
import { LOCK_STALE_MS } from '../../src/constants/lifecycle.js';
import { daemonStart, type SpawnedChild } from '../../src/lifecycle.js';
import { lockFilePath } from '../../src/paths.js';

let data: string;
let env: NodeJS.ProcessEnv;
let entry: string;

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'lc-inj-'));
  entry = join(data, 'server.js');
  writeFileSync(entry, '');
  env = { ...process.env, [ENV_HOME]: data };
});
afterEach(() => rmSync(data, { recursive: true, force: true }));

/** Fake child; `exitWith` fires its exit handler as soon as it is registered. */
const fakeSpawn = (exitWith?: number) => {
  const calls: string[][] = [];
  const spawn = (_cmd: string, args: string[]): SpawnedChild => {
    calls.push(args);
    return {
      on: (_ev, fn) => {
        if (exitWith !== undefined) fn(exitWith);
      },
      unref: () => {},
    };
  };
  return { spawn, calls };
};

describe('daemonStart with injected clock/sleep/spawn', () => {
  it('reports a child that exits during startup without spawning a process', async () => {
    const clock = fakeClock(0);
    const { spawn, calls } = fakeSpawn(3);
    await expect(
      daemonStart({ env, serverEntry: entry, clock, sleep: async (ms) => clock.advance(ms), spawn }),
    ).rejects.toThrow(/exited during startup \(code 3\)/);
    expect(calls).toEqual([[entry]]);
    expect(existsSync(lockFilePath(env))).toBe(false);
  });

  it('times out on the injected clock, not real time', async () => {
    const clock = fakeClock(0);
    const { spawn } = fakeSpawn();
    const started = Date.now();
    await expect(
      daemonStart({ env, serverEntry: entry, clock, sleep: async (ms) => clock.advance(ms), spawn, startupTimeoutMs: 60_000 }),
    ).rejects.toThrow(/timed out after 60000ms/);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(existsSync(lockFilePath(env))).toBe(false);
  });

  it('a lock older than LOCK_STALE_MS (by the injected clock) is taken over', async () => {
    const clock = fakeClock(10 * LOCK_STALE_MS);
    writeFileSync(lockFilePath(env), JSON.stringify({ pid: process.pid, at: clock.now().getTime() - LOCK_STALE_MS - 1 }));
    const { spawn, calls } = fakeSpawn(1);
    await expect(
      daemonStart({ env, serverEntry: entry, clock, sleep: async (ms) => clock.advance(ms), spawn }),
    ).rejects.toThrow(/exited during startup/);
    expect(calls).toHaveLength(1);
  });

  it('a fresh lock held by a live pid times out waiting', async () => {
    const clock = fakeClock(10 * LOCK_STALE_MS);
    writeFileSync(lockFilePath(env), JSON.stringify({ pid: process.pid, at: clock.now().getTime() }));
    const { spawn, calls } = fakeSpawn();
    await expect(
      daemonStart({ env, serverEntry: entry, clock, sleep: async (ms) => clock.advance(ms), spawn, startupTimeoutMs: 1_000 }),
    ).rejects.toThrow(/timed out waiting for .*daemon\.lock/);
    expect(calls).toHaveLength(0);
  });
});
