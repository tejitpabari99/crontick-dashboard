import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENV_HOME } from '../../src/constants/env.js';
import { RECONCILE_INTERVAL_MS } from '../../src/constants/state.js';
import { startServer } from '../../src/http/server.js';

let data: string;
let ui: string;
beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'st-data-'));
  ui = mkdtempSync(join(tmpdir(), 'st-ui-'));
  writeFileSync(join(ui, 'index.html'), '<html></html>');
  mkdirSync(join(data, 'feed'), { recursive: true });
});
afterEach(() => {
  rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  rmSync(ui, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('startServer injected timers', () => {
  it('schedules the reconcile interval on the injected timers and clears it on stop', async () => {
    const set: Array<{ fn: () => void; ms: number }> = [];
    const cleared: unknown[] = [];
    const timers = {
      setInterval: (fn: () => void, ms: number) => (set.push({ fn, ms }), set.length),
      clearInterval: (h: unknown) => void cleared.push(h),
    };
    const s = await startServer({ env: { [ENV_HOME]: data }, uiDir: ui, port: 0, timers });
    expect(set.map((t) => t.ms)).toEqual([RECONCILE_INTERVAL_MS]);
    set[0]!.fn(); // deterministic reconcile tick
    await s.stop();
    expect(cleared).toEqual([1]);
  });
});
