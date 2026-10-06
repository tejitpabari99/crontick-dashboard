import { describe, expect, it } from 'vitest';
import { createNotifier } from '../../src/integrations/notify/notifier.js';
import { isRegisteredType, registry } from '../../src/contract/registry.js';
import { stripMarkdown } from '../../src/utils/markdown.js';
import { FakeNotifyAdapter } from '../../src/integrations/notify/fake.js';
import { fakeClock } from '../../src/clock.js';
import type { CardEventListener, CardEventType } from '../../src/feed/events.js';
import type { Card } from '../../src/contract/validate.js';
import { NOTIFY_BURST_WINDOW_MS, NOTIFY_MAX_BODY } from '../../src/constants/notify.js';

function bus() {
  const ls: Record<string, Set<CardEventListener>> = {};
  return {
    events: {
      on(type: CardEventType, fn: CardEventListener) {
        (ls[type] ??= new Set()).add(fn);
        return () => void ls[type]!.delete(fn);
      },
      off(type: CardEventType, fn: CardEventListener) {
        ls[type]?.delete(fn);
      },
    },
    emit(type: CardEventType, card: Record<string, unknown>) {
      for (const fn of [...(ls[type] ?? [])]) fn({ card: card as unknown as Card, file: 'x.json' });
    },
    count: (type: string) => ls[type]?.size ?? 0,
  };
}

const card = (over: Record<string, unknown> = {}) => ({
  id: 'my-card', kind: 'alert', type: 'markdown', title: 'Build failed', updatedAt: '2026-01-01T00:00:00Z',
  priority: 1, notify: true, data: { text: 'hello' }, ...over,
});

function setup(gate: boolean | { enabled: boolean } = true, port = 4321) {
  const b = bus();
  const adapter = new FakeNotifyAdapter();
  const n = createNotifier({ events: b.events, adapter, getPort: () => port, gate });
  return { b, adapter, n };
}

describe('notifier', () => {
  it('new and changed each fire once', () => {
    const { b, adapter } = setup();
    b.emit('card:new', card());
    expect(adapter.calls).toHaveLength(1);
    b.emit('card:changed', card());
    expect(adapter.calls).toHaveLength(2);
    expect(adapter.calls[0]).toEqual({ title: 'Build failed', body: 'hello', openUrl: 'http://127.0.0.1:4321/#card=my-card' });
  });
  it('ignores removed, notify:false, missing notify', () => {
    const { b, adapter } = setup();
    b.emit('card:removed', card());
    b.emit('card:new', card({ notify: false }));
    b.emit('card:new', card({ notify: undefined }));
    expect(adapter.calls).toHaveLength(0);
  });
  it('gate off -> zero calls (boolean and result)', () => {
    for (const g of [false, { enabled: false }]) {
      const { b, adapter } = setup(g);
      b.emit('card:new', card());
      expect(adapter.calls).toHaveLength(0);
    }
  });
  it('encodes id in url and reads port lazily', () => {
    const { b, adapter } = setup(true, 99);
    b.emit('card:new', card({ id: 'a b#c' }));
    expect(adapter.calls[0]!.openUrl).toBe('http://127.0.0.1:99/#card=a%20b%23c');
  });
  it('dispose unsubscribes', () => {
    const { b, adapter, n } = setup();
    n.dispose();
    expect(b.count('card:new') + b.count('card:changed')).toBe(0);
    b.emit('card:new', card());
    expect(adapter.calls).toHaveLength(0);
  });
  it('adapter throw/reject does not propagate', async () => {
    const { b, adapter } = setup();
    adapter.failWith = { mode: 'throw', error: new Error('x') };
    expect(() => b.emit('card:new', card())).not.toThrow();
    adapter.failWith = { mode: 'reject', error: new Error('y') };
    expect(() => b.emit('card:new', card())).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
  it('truncates body to NOTIFY_MAX_BODY chars', () => {
    const { b, adapter } = setup();
    b.emit('card:new', card({ data: { text: 'a'.repeat(500) } }));
    expect(adapter.calls[0]!.body).toHaveLength(NOTIFY_MAX_BODY);
    expect(adapter.calls[0]!.body.endsWith('…')).toBe(true);
  });
});

/** Per-type summaries via the registry (what the notifier uses). */
const summarize = (c: { type: string; data?: unknown }): string => (isRegisteredType(c.type) ? registry[c.type].summary(c.data) : '');

describe('summarize', () => {
  it('strips markdown from first non-empty line', () => {
    expect(stripMarkdown('## **Deploy** failed on [prod](http://x) `now`')).toBe('Deploy failed on prod now');
    expect(summarize(card({ data: { text: '\n\n> - _Disk_ at ![](u) 95%\nmore' } }) as never)).toBe('Disk at 95%');
  });
  it('list', () => {
    expect(summarize(card({ type: 'list', data: { items: [{ text: 'Pay rent' }, { text: 'b' }] } }) as never)).toBe('Pay rent (+1 more)');
    expect(summarize(card({ type: 'list', data: { items: [{ text: 'Only' }] } }) as never)).toBe('Only');
    expect(summarize(card({ type: 'list', data: { items: [] } }) as never)).toBe('');
  });
  it('kpi', () => {
    expect(summarize(card({ type: 'kpi', data: { items: [{ value: 42, unit: '%', label: 'CPU' }] } }) as never)).toBe('42% CPU');
    expect(summarize(card({ type: 'kpi', data: { items: [{ value: 'Deployed' }] } }) as never)).toBe('Deployed');
  });
  it('table', () => {
    expect(summarize(card({ type: 'table', data: { columns: ['a'], rows: [{ cells: ['x'] }, { cells: ['y'] }] } }) as never)).toBe('2 rows');
    expect(summarize(card({ type: 'table', data: { columns: ['a'], rows: [{ cells: ['x'] }] } }) as never)).toBe('1 row');
  });
  it('media', () => {
    expect(summarize(card({ type: 'media', data: { items: [{ src: 'u', caption: 'Sunset' }] } }) as never)).toBe('Sunset');
    expect(summarize(card({ type: 'media', data: { items: [{ src: 'u' }, { src: 'v' }] } }) as never)).toBe('2 images');
  });
  it('unknown/missing data -> empty', () => {
    expect(summarize(card({ type: 'zzz', data: undefined }) as never)).toBe('');
  });
});

describe('burst control', () => {
  function burst(threshold = 3) {
    const b = bus();
    const adapter = new FakeNotifyAdapter();
    const clock = fakeClock(0);
    const pending: { at: number; fn: () => void; id: number }[] = [];
    let id = 0;
    const timers = {
      setTimeout: (fn: () => void, ms: number) => {
        pending.push({ at: clock.now().getTime() + ms, fn, id: ++id });
        return id;
      },
      clearTimeout: (h: unknown) => {
        const i = pending.findIndex((p) => p.id === h);
        if (i >= 0) pending.splice(i, 1);
      },
    };
    const advance = (ms: number) => {
      const end = clock.now().getTime() + ms;
      for (;;) {
        const next = pending.filter((p) => p.at <= end).sort((a, c) => a.at - c.at)[0];
        if (!next) break;
        pending.splice(pending.indexOf(next), 1);
        clock.set(next.at);
        next.fn();
      }
      clock.set(end);
    };
    const n = createNotifier({ events: b.events, adapter, getPort: () => 4321, gate: true, clock, timers, getThreshold: () => threshold });
    const emit = (i: number, over: Record<string, unknown> = {}) => b.emit('card:new', card({ id: `c${i}`, title: `T${i}`, ...over }));
    return { b, adapter, n, advance, emit, pending };
  }

  it('5 cards in 10s -> 3 toasts + 1 summary at window close', () => {
    const { adapter, advance, emit } = burst();
    for (let i = 0; i < 5; i++) { emit(i); advance(1000); }
    expect(adapter.calls).toHaveLength(3);
    advance(5000);
    expect(adapter.calls).toHaveLength(4);
    expect(adapter.calls[3]).toEqual({
      title: '2 more updates on your dashboard',
      body: 'Open the dashboard to see them.',
      openUrl: 'http://127.0.0.1:4321/',
    });
    advance(60_000);
    expect(adapter.calls).toHaveLength(4);
  });
  it('high-priority overflow is named in summary', () => {
    const { adapter, advance, emit } = burst(3);
    for (let i = 0; i < 3; i++) emit(i);
    emit(3, { priority: 4 });
    emit(4, { priority: 1 });
    emit(5, { priority: 5 });
    emit(6, { priority: 5, kind: 'panel' });
    advance(NOTIFY_BURST_WINDOW_MS);
    expect(adapter.calls).toHaveLength(4);
    expect(adapter.calls[3]!.title).toBe('4 more updates on your dashboard');
    expect(adapter.calls[3]!.body).toBe('High priority: T3, T5');
  });
  it('new window after expiry starts fresh', () => {
    const { adapter, advance, emit } = burst();
    for (let i = 0; i < 4; i++) emit(i);
    advance(NOTIFY_BURST_WINDOW_MS);
    expect(adapter.calls).toHaveLength(4);
    for (let i = 10; i < 13; i++) emit(i);
    expect(adapter.calls).toHaveLength(7);
    expect(adapter.calls[6]!.title).toBe('T12');
  });
  it('single overflow uses singular', () => {
    const { adapter, advance, emit } = burst();
    for (let i = 0; i < 4; i++) emit(i);
    advance(NOTIFY_BURST_WINDOW_MS);
    expect(adapter.calls[3]!.title).toBe('1 more update on your dashboard');
  });
  it('dispose flushes pending summary and clears timers', () => {
    const { adapter, n, emit, pending, advance } = burst();
    for (let i = 0; i < 5; i++) emit(i);
    n.dispose();
    expect(adapter.calls).toHaveLength(4);
    expect(pending).toHaveLength(0);
    advance(20_000);
    expect(adapter.calls).toHaveLength(4);
  });
});
