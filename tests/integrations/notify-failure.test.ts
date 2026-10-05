import { describe, expect, it } from 'vitest';
import { createNotifier } from '../../src/integrations/notify/notifier.js';
import { FakeNotifyAdapter } from '../../src/integrations/notify/fake.js';
import { resolveNotifyMode } from '../../src/integrations/notify/gate.js';
import { createWarnings } from '../../src/state/warnings.js';
import { computeSnapshot } from '../../src/compute/snapshot.js';
import type { CardEventListener, CardEventType } from '../../src/feed/events.js';
import type { Card } from '../../src/contract/validate.js';

function bus() {
  const ls: Record<string, Set<CardEventListener>> = {};
  return {
    events: {
      on(type: CardEventType, fn: CardEventListener) {
        (ls[type] ??= new Set()).add(fn);
        return () => void ls[type]!.delete(fn);
      },
    },
    emit(type: CardEventType, card: Record<string, unknown>) {
      for (const fn of [...(ls[type] ?? [])]) fn({ card: card as unknown as Card, file: 'x.json' });
    },
  };
}
const card = (id = 'c1') => ({
  id, kind: 'alert', type: 'markdown', title: 'T', updatedAt: '2026-01-01T00:00:00Z', priority: 1, notify: true,
  data: { text: 'hi' },
});
const flush = () => new Promise((r) => setTimeout(r, 0));
const snapWarnings = (w: ReturnType<typeof createWarnings>) =>
  computeSnapshot([], { acks: {}, hidden: {}, notified: {}, checks: {} } as never,
    { nowPriorityThreshold: 3, pollIntervalMs: 1000, timezone: 'UTC' }, new Date(), w.list()).warnings;

describe('failure isolation', () => {
  for (const mode of ['throw', 'reject'] as const) {
    it(`adapter ${mode}: listener returns sync, logged, no retry, later cards notify, warning set then cleared`, async () => {
      const b = bus();
      const adapter = new FakeNotifyAdapter();
      const warnings = createWarnings();
      const logs: string[] = [];
      createNotifier({ events: b.events, adapter, getPort: () => 1, gate: true, warnings, logger: { warn: (m) => logs.push(m) } });
      adapter.failWith = { mode, error: new Error('boom') };
      expect(() => b.emit('card:new', card('a'))).not.toThrow();
      await flush();
      expect(adapter.calls).toHaveLength(1); // never retried
      expect(logs.join()).toContain('boom');
      expect(warnings.list().join()).toMatch(/delivery/i);
      adapter.failWith = undefined;
      b.emit('card:new', card('b'));
      await flush();
      expect(adapter.calls).toHaveLength(2);
      expect(warnings.list()).toEqual([]);
    });
  }
  it('does not await delivery (hanging adapter does not stall)', () => {
    const b = bus();
    const calls: unknown[] = [];
    createNotifier({ events: b.events, adapter: { notify: (p) => (calls.push(p), new Promise<void>(() => {})) }, getPort: () => 1, gate: true });
    b.emit('card:new', card('a'));
    b.emit('card:new', card('b'));
    expect(calls).toHaveLength(2);
  });
  it('throwing logger / non-promise adapter return do not propagate', () => {
    const b = bus();
    createNotifier({
      events: b.events, getPort: () => 1, gate: true,
      adapter: { notify: (() => { throw new Error('x'); }) as never },
      logger: { warn: () => { throw new Error('log'); } },
    });
    expect(() => b.emit('card:new', card())).not.toThrow();
    const b2 = bus();
    createNotifier({ events: b2.events, getPort: () => 1, gate: true, adapter: { notify: (() => undefined) as never } });
    expect(() => b2.emit('card:new', card())).not.toThrow();
  });
});

describe('off-state warnings + status', () => {
  const off = resolveNotifyMode({ platform: 'linux', env: { DISPLAY: ':0' }, notifySendOnPath: false, configValue: 'auto' });
  it('off: warning with mode+reason appears in snapshot; status exposes it', () => {
    const warnings = createWarnings();
    const n = createNotifier({ events: bus().events, adapter: new FakeNotifyAdapter(), getPort: () => 1, gate: off, warnings });
    const w = snapWarnings(warnings);
    expect(w.some((m) => m.includes('off') && m.includes('notify-send not found'))).toBe(true);
    expect(n.status()).toMatchObject({ enabled: false, mode: 'off', reason: off.reason });
  });
  it('off without gate warning (headless) still warns with reason', () => {
    const r = resolveNotifyMode({ platform: 'linux', env: {}, notifySendOnPath: false, configValue: 'auto' });
    const warnings = createWarnings();
    createNotifier({ events: bus().events, adapter: new FakeNotifyAdapter(), getPort: () => 1, gate: r, warnings });
    expect(snapWarnings(warnings).join()).toContain('headless');
  });
  it('on: no warning, status on', () => {
    const on = resolveNotifyMode({ platform: 'darwin', env: {}, notifySendOnPath: false, configValue: 'auto' });
    const warnings = createWarnings();
    const n = createNotifier({ events: bus().events, adapter: new FakeNotifyAdapter(), getPort: () => 1, gate: on, warnings });
    expect(snapWarnings(warnings)).toEqual([]);
    expect(n.status()).toMatchObject({ enabled: true, mode: 'on' });
  });
  it('boolean gate works; dynamic gate flipping clears warning on next event', () => {
    let g: { enabled: boolean; mode: 'on' | 'off'; reason: string } = { enabled: false, mode: 'off', reason: 'r1' };
    const b = bus();
    const warnings = createWarnings();
    createNotifier({ events: b.events, adapter: new FakeNotifyAdapter(), getPort: () => 1, gate: () => g, warnings });
    expect(warnings.list()).toHaveLength(1);
    g = { enabled: true, mode: 'on', reason: 'r2' };
    b.emit('card:new', card());
    expect(warnings.list()).toEqual([]);
  });
});
