import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { putCard } from '../helpers/feed-folder.js';
import { fakeClock } from '../../src/clock.js';
import { startServer, type RunningServer } from '../../src/http/server.js';
import { FakeNotifyAdapter } from '../../src/integrations/notify/fake.js';
import type { Snapshot } from '../../src/shared/api-types.js';
import { ENV_HOME } from '../../src/constants/env.js';
import { MUTATION_HEADER, MUTATION_HEADER_VALUE } from '../../src/constants/http.js';
import { loopbackUrl } from '../../src/utils/loopback.js';

let data: string;
let ui: string;
let running: RunningServer | undefined;
const clock = fakeClock('2026-06-01T12:00:00Z');
const put = (id: string, text: string): void => void putCard(join(data, 'feed'), id, text);
const T1 = '2026-06-01T10:00:00Z';
const T2 = '2026-06-01T11:00:00Z';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const card = (id: string, over: Record<string, unknown> = {}): string =>
  JSON.stringify({ id, kind: 'panel', type: 'markdown', title: id, updatedAt: T1, notify: true, data: { text: `hi ${id}` }, ...over });

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'ns-data-'));
  ui = mkdtempSync(join(tmpdir(), 'ns-ui-'));
  writeFileSync(join(ui, 'index.html'), '<html></html>');
  mkdirSync(join(data, 'feed'), { recursive: true });
});
afterEach(async () => {
  await running?.stop();
  running = undefined;
  rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  rmSync(ui, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const boot = async (adapter: FakeNotifyAdapter, extra: Record<string, unknown> = {}): Promise<RunningServer> =>
  (running = await startServer({
    env: { [ENV_HOME]: data },
    clock,
    uiDir: ui,
    port: 0,
    notifyAdapter: adapter,
    notifyPlatform: 'darwin',
    ...extra,
  }));
const restart = async (adapter: FakeNotifyAdapter): Promise<RunningServer> => {
  await running?.stop();
  running = undefined;
  return boot(adapter);
};
const snap = async (s: RunningServer): Promise<Snapshot> =>
  (await (await fetch(`${loopbackUrl(s.port)}/api/snapshot`)).json()) as Snapshot;

describe('notifications wired into server', () => {
  it('notify:true new fires once with deep link; restart unchanged fires nothing', async () => {
    put('a', card('a'));
    const a1 = new FakeNotifyAdapter();
    const s = await boot(a1);
    expect(a1.calls).toHaveLength(1);
    expect(a1.calls[0]).toMatchObject({ title: 'a', body: 'hi a', openUrl: `${loopbackUrl(s.port)}/#card=a` });
    const a2 = new FakeNotifyAdapter();
    await restart(a2);
    await sleep(200);
    expect(a2.calls).toHaveLength(0);
  });

  it('changed-while-down fires on restart; live change fires once', async () => {
    put('a', card('a'));
    await boot(new FakeNotifyAdapter());
    await running!.stop();
    running = undefined;
    put('a', card('a', { updatedAt: T2 }));
    const a2 = new FakeNotifyAdapter();
    const s = await boot(a2);
    expect(a2.calls).toHaveLength(1);
    put('a', card('a', { updatedAt: '2026-06-01T11:30:00Z' }));
    for (let i = 0; i < 200 && a2.calls.length < 2; i++) await sleep(50);
    expect(a2.calls).toHaveLength(2);
    expect(s.notifier.status().enabled).toBe(true);
  }, 20_000);

  it('notify:false, Broken and out-of-window fire nothing', async () => {
    put('f', card('f', { notify: false }));
    put('broken', '{ not json');
    put('bad', card('bad', { updatedAt: 'nope' }));
    put('old', card('old', { show: { cron: '0 0 1 1 *', for: '1h' } }));
    const a = new FakeNotifyAdapter();
    await boot(a);
    await sleep(300);
    expect(a.calls).toHaveLength(0);
  });

  it('server write-back of a complete item fires nothing', async () => {
    put(
      'l1',
      card('l1', { type: 'list', data: { items: [{ id: 'c', text: 'C', action: 'complete' }] } }),
    );
    const a = new FakeNotifyAdapter();
    const s = await boot(a);
    expect(a.calls).toHaveLength(1); // the initial new card
    const r = await fetch(`${loopbackUrl(s.port)}/api/cards/l1/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [MUTATION_HEADER]: MUTATION_HEADER_VALUE },
      body: JSON.stringify({ itemId: 'c', updatedAt: T1 }),
    });
    expect(r.status).toBe(200);
    await sleep(400);
    expect(a.calls).toHaveLength(1);
  });

  it('headless (gate off): no adapter call, no error, snapshot warning has reason', async () => {
    put('a', card('a'));
    const a = new FakeNotifyAdapter();
    const s = await boot(a, { notifyPlatform: 'linux', env: { [ENV_HOME]: data, PATH: '' } });
    await sleep(200);
    expect(a.calls).toHaveLength(0);
    expect(s.notifier.status()).toMatchObject({ enabled: false, mode: 'off' });
    expect((await snap(s)).warnings.join('\n')).toContain('headless');
  });

  it('config notifications.os=off disables; stop disposes subscription', async () => {
    writeFileSync(join(data, 'config.json'), JSON.stringify({ notifications: { os: 'off' } }));
    put('a', card('a'));
    const a = new FakeNotifyAdapter();
    const s = await boot(a);
    await sleep(100);
    expect(a.calls).toHaveLength(0);
    expect(s.notifier.status().enabled).toBe(false);
  });
});
