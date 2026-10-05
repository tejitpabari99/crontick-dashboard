import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeClock } from '../../src/clock.js';
import { createStateStore } from '../../src/state/store.js';

const DAY = 86_400_000;
let dir: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'state-'));
  env = { CRONTICK_DASHBOARD_HOME: dir };
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

describe('state store', () => {
  it('has defaults and no file until first mutation', async () => {
    const s = createStateStore({ env, clock: fakeClock('2026-01-01T00:00:00Z') });
    expect(s.get()).toMatchObject({ version: 1, layout: [] });
    expect(existsSync(join(dir, 'state.json'))).toBe(false);
    await s.ack('a', '2026-01-01T00:00:00Z');
    expect(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).acks.a).toBe('2026-01-01T00:00:00Z');
    expect(readdirSync(dir).some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('50 concurrent mutations all land in valid JSON', async () => {
    const s = createStateStore({ env, clock: fakeClock(0) });
    await Promise.all(Array.from({ length: 50 }, (_, i) => s.ack(`id${i}`, `t${i}`)));
    const disk = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
    expect(Object.keys(disk.acks)).toHaveLength(50);
    const s2 = createStateStore({ env, clock: fakeClock(0) });
    expect(s2.get().acks['id49']).toBe('t49');
  });

  it('recovers from corrupt file with warning', () => {
    writeFileSync(join(dir, 'state.json'), '{not json');
    const s = createStateStore({ env, clock: fakeClock('2026-01-01T00:00:00Z') });
    expect(s.get().acks).toEqual({});
    expect(s.warnings.length).toBe(1);
    expect(readdirSync(dir).some((f) => f.startsWith('state.json.corrupt-'))).toBe(true);
    expect(existsSync(join(dir, 'state.json'))).toBe(false);
  });

  it('recovers from schema-invalid file', () => {
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ version: 2 }));
    const s = createStateStore({ env, clock: fakeClock(0) });
    expect(s.warnings.length).toBe(1);
  });

  it('keeps entries for absent ids 30 days, then prunes', async () => {
    const clock = fakeClock('2026-01-01T00:00:00Z');
    const s = createStateStore({ env, clock });
    await s.ack('a', 'u1');
    await s.hide('a', true);
    await s.reconcile(new Set(['a']));
    // deleted from feed
    clock.advance(10 * DAY);
    await s.reconcile(new Set());
    expect(s.get().acks['a']).toBe('u1');
    // recreated: lastSeen refreshed
    await s.reconcile(new Set(['a']));
    clock.advance(29 * DAY);
    await s.reconcile(new Set());
    expect(s.get().acks['a']).toBe('u1');
    expect(s.get().hidden['a']).toBe(true);
    clock.advance(2 * DAY);
    await s.reconcile(new Set());
    expect(s.get().acks['a']).toBeUndefined();
    expect(s.get().hidden['a']).toBeUndefined();
    expect(s.get().lastSeen['a']).toBeUndefined();
  });

  it('starts the 30-day clock for ids without lastSeen', async () => {
    const clock = fakeClock('2026-01-01T00:00:00Z');
    const s = createStateStore({ env, clock });
    await s.ack('x', 'u');
    await s.reconcile(new Set());
    expect(s.get().lastSeen['x']).toBeDefined();
    expect(s.get().acks['x']).toBe('u');
  });

  it('is safe with __proto__ ids', async () => {
    const s = createStateStore({ env, clock: fakeClock(0) });
    await s.ack('__proto__', 'u');
    expect(({} as Record<string, unknown>)['u']).toBeUndefined();
    expect(Object.keys(s.get().acks)).toContain('__proto__');
    const s2 = createStateStore({ env, clock: fakeClock(0) });
    expect(s2.get().acks['__proto__']).toBe('u');
    expect(Object.getPrototypeOf(s2.get().acks)).toBeNull();
  });

  it('supports checks, notified, layout, unack', async () => {
    const s = createStateStore({ env, clock: fakeClock(0) });
    await s.setChecks('c', 'u1', ['i1']);
    await s.setNotified('c', 'u1');
    await s.setLayout([{ id: 'c' }]);
    await s.ack('c', 'u1');
    await s.unack('c');
    const st = s.get();
    expect(st.checks['c']).toEqual({ updatedAt: 'u1', items: ['i1'] });
    expect(st.notified['c']).toBe('u1');
    expect(st.layout).toEqual([{ id: 'c' }]);
    expect(st.acks['c']).toBeUndefined();
  });

  it('retries EPERM on rename with backoff', async () => {
    let calls = 0;
    const s = createStateStore({
      env,
      clock: fakeClock(0),
      renameFn: async (a, b) => {
        if (++calls < 3) throw Object.assign(new Error('x'), { code: 'EPERM' });
        await rename(a, b);
      },
      retryDelayMs: 1,
    });
    await s.ack('a', 'u');
    expect(calls).toBe(3);
    expect(existsSync(join(dir, 'state.json'))).toBe(true);
  });

  it('a failed write rejects but later mutations still work', async () => {
    let fail = true;
    const s = createStateStore({
      env,
      clock: fakeClock(0),
      renameFn: async (a, b) => {
        if (fail) throw Object.assign(new Error('boom'), { code: 'EIO' });
        await rename(a, b);
      },
    });
    await expect(s.ack('a', 'u')).rejects.toThrow('boom');
    fail = false;
    await s.ack('b', 'u');
    expect(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).acks.b).toBe('u');
  });
});
