import { describe, expect, it, vi } from 'vitest';
import { createClient } from '../src/api/client.ts';
import { createSnapshotStore } from '../src/api/store.ts';
import { createMutations } from '../src/api/mutations.ts';
import { CONFLICT_TOAST } from '../src/constants/messages.ts';
import { createToastStore } from '../src/api/toasts.ts';
import type { Snapshot } from '../src/api/types.ts';

const snap = (over: Partial<Snapshot> = {}): Snapshot =>
  ({
    serverTime: 't',
    rev: 'r1',
    warnings: [],
    config: { pollIntervalMs: 30000, nowPriorityThreshold: 5 },
    zones: { alerts: ['al'], now: [], grid: ['a', 'b'], tray: [], hidden: [] },
    cards: {
      a: {
        id: 'a',
        kind: 'panel',
        updatedAt: '2026-01-01T00:00:00Z',
        checked: ['d1'],
        data: { items: [{ id: 'i1', checked: true }, { id: 'i2' }, { id: 'i3' }] },
      },
      b: { id: 'b', kind: 'panel', updatedAt: 'x' },
      al: { id: 'al', kind: 'alert', updatedAt: 'x' },
    },
    layout: [],
    ...over,
  }) as unknown as Snapshot;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

/** Mutation responses are queued; snapshot GETs always return `current`. */
function setup(mutRes: Array<Response | Error | Promise<Response>>) {
  let current = snap();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === '/api/snapshot') return json(200, current, { ETag: String(Math.random()) });
    calls.push({ url, init: init ?? {} });
    const r = mutRes.shift();
    if (!r) throw new Error('no response');
    if (r instanceof Error) throw r;
    return r;
  });
  const store = createSnapshotStore({ client: createClient({ fetch: fetchFn }), doc: undefined });
  const toasts = createToastStore();
  const m = createMutations({ store, toasts, fetch: fetchFn });
  return { store, toasts, m, calls, fetchFn, setCurrent: (s: Snapshot) => (current = s) };
}


describe('mutations', () => {
  it('done: optimistic tray patch, headers, refetch, then settled', async () => {
    const t = setup([json(200, { rev: 'r2' })]);
    await t.store.refetch();
    const p = t.m.done('a');
    expect(t.m.getView().state.snapshot?.zones.tray).toEqual(['a']);
    expect(t.m.getView().state.snapshot?.zones.grid).toEqual(['b']);
    t.setCurrent(snap({ zones: { alerts: ['al'], now: [], grid: ['b'], tray: ['a'], hidden: [] } }));
    await p;
    expect(t.calls[0]!.url).toBe('/api/cards/a/done');
    expect(t.calls[0]!.init.method).toBe('POST');
    expect(t.calls[0]!.init.headers).toEqual({ 'Content-Type': 'application/json', 'X-Crontick-Dashboard': '1' });
    expect(t.m.getView().state.snapshot?.zones.tray).toEqual(['a']);
    expect(t.toasts.getSnapshot()).toEqual([]);
  });

  it('mutation during an in-flight poll: waits and refetches fresh, patch is not dropped by stale data', async () => {
    const before = snap();
    const after = snap({ zones: { alerts: ['al'], now: [], grid: ['b'], tray: ['a'], hidden: [] } });
    let applied = false;
    let releasePoll!: () => void;
    const gate = new Promise<void>((r) => (releasePoll = r));
    let gets = 0;
    const fetchFn = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === '/api/snapshot') {
        gets += 1;
        if (gets === 1) {
          await gate; // poll started before the mutation was applied
          return json(200, before, { ETag: 'e1' });
        }
        return json(200, applied ? after : before, { ETag: `e${gets}` });
      }
      applied = true;
      return json(200, { rev: 'r2' });
    });
    const store = createSnapshotStore({ client: createClient({ fetch: fetchFn }), doc: undefined });
    const m = createMutations({ store, toasts: createToastStore(), fetch: fetchFn });
    const poll = store.refetch();
    const p = m.done('a');
    await new Promise((r) => setTimeout(r, 0));
    releasePoll(); // pre-mutation data arrives
    await poll;
    expect(m.getView().state.snapshot?.zones.tray).toEqual(['a']); // optimistic patch still applied
    await p;
    expect(gets).toBe(2);
    expect(m.getView().state.snapshot?.zones.tray).toEqual(['a']);
  });

  it('500: rolls back and toasts server error', async () => {
    const t = setup([json(500, { error: 'disk full' })]);
    await t.store.refetch();
    const p = t.m.hide('a');
    expect(t.m.getView().state.snapshot?.zones.hidden).toEqual(['a']);
    await p;
    expect(t.m.getView().state.snapshot?.zones.hidden).toEqual([]);
    expect(t.m.getView().state.snapshot?.zones.grid).toEqual(['a', 'b']);
    expect(t.toasts.getSnapshot().map((x) => x.message)).toEqual(['disk full']);
  });

  it('409: reverts, silently refetches, toasts "card updated, try again"', async () => {
    const t = setup([json(409, { error: 'card updated' })]);
    await t.store.refetch();
    const before = t.fetchFn.mock.calls.filter((c) => c[0] === '/api/snapshot').length;
    await t.m.tick('al');
    expect(t.m.getView().state.snapshot?.zones.alerts).toEqual(['al']);
    expect(t.toasts.getSnapshot().map((x) => x.message)).toEqual([CONFLICT_TOAST]);
    await vi.waitFor(() =>
      expect(t.fetchFn.mock.calls.filter((c) => c[0] === '/api/snapshot').length).toBeGreaterThan(before),
    );
  });

  it('tick optimistically removes the alert from alerts and does not add it to tray', async () => {
    let release!: (r: Response) => void;
    const t = setup([new Promise<Response>((r) => (release = r))]);
    await t.store.refetch();
    const p = t.m.tick('al');
    const z = t.m.getView().state.snapshot?.zones;
    expect(z?.alerts).toEqual([]);
    expect(z?.tray).toEqual([]);
    release(json(200, {}));
    await p;
  });

  it('network failure rolls back and toasts', async () => {
    const t = setup([new Error('boom')]);
    await t.store.refetch();
    await t.m.unhide('a');
    expect(t.toasts.getSnapshot()).toHaveLength(1);
  });

  it('layout: patches layout, PUT body is the layout', async () => {
    const t = setup([json(200, { rev: 'r2' })]);
    await t.store.refetch();
    const layout = [{ i: 'a', x: 0, y: 0, w: 3, h: 4 }];
    const p = t.m.putLayout(layout);
    expect(t.m.getView().state.snapshot?.layout).toEqual(layout);
    await p;
    expect(t.calls[0]!.url).toBe('/api/layout');
    expect(t.calls[0]!.init.method).toBe('PUT');
    expect(JSON.parse(String(t.calls[0]!.init.body))).toEqual(layout);
    expect(t.m.getView().state.snapshot?.layout).toEqual([]);
  });

  it('onItemAction: checked/pending sets, body, resolves on 200', async () => {
    let release!: (r: Response) => void;
    const t = setup([new Promise<Response>((r) => (release = r))]);
    await t.store.refetch();
    expect([...t.m.getChecked('a')].sort()).toEqual(['d1', 'i1']);
    const p = t.m.onItemAction('a', 'i2');
    await vi.waitFor(() => expect(t.calls).toHaveLength(1));
    expect([...t.m.getChecked('a')].sort()).toEqual(['d1', 'i1', 'i2']);
    expect([...t.m.getPending('a')]).toEqual(['i2']);
    expect(t.calls[0]!.url).toBe('/api/cards/a/actions');
    expect(JSON.parse(String(t.calls[0]!.init.body))).toEqual({
      itemId: 'i2',
      updatedAt: '2026-01-01T00:00:00Z',
      checked: true,
    });
    release(json(200, { rev: 'r2' }));
    await expect(p).resolves.toBeUndefined();
    expect([...t.m.getPending('a')]).toEqual([]);
    expect([...t.m.getChecked('a')].sort()).toEqual(['d1', 'i1']);
  });

  it('onItemAction untick removes id optimistically; 500 rejects with server message and reverts', async () => {
    let release!: (r: Response) => void;
    const t = setup([new Promise<Response>((r) => (release = r))]);
    await t.store.refetch();
    const p = t.m.onItemAction('a', 'i1', false);
    const assertion = expect(p).rejects.toThrow('write failed');
    await vi.waitFor(() => expect(t.calls).toHaveLength(1));
    expect(t.m.getChecked('a').has('i1')).toBe(false);
    expect(JSON.parse(String(t.calls[0]!.init.body)).checked).toBe(false);
    release(json(500, { error: 'write failed' }));
    await assertion;
    expect(t.m.getChecked('a').has('i1')).toBe(true);
    expect(t.m.getPending('a').size).toBe(0);
    expect(t.toasts.getSnapshot().map((x) => x.message)).toEqual(['write failed']);
  });

  it('onItemAction 409 rejects and toasts conflict text', async () => {
    const t = setup([json(409, { error: 'card updated' })]);
    await t.store.refetch();
    await expect(t.m.onItemAction('a', 'i2')).rejects.toThrow('card updated');
    expect(t.toasts.getSnapshot().map((x) => x.message)).toEqual([CONFLICT_TOAST]);
    expect(t.m.getChecked('a').has('i2')).toBe(false);
  });
});

describe('toast store', () => {
  it('push/dismiss notify and keep stable snapshots', () => {
    const s = createToastStore();
    const l = vi.fn();
    s.subscribe(l);
    const id = s.push('x');
    expect(l).toHaveBeenCalledTimes(1);
    const snapA = s.getSnapshot();
    expect(s.getSnapshot()).toBe(snapA);
    s.dismiss(id);
    expect(s.getSnapshot()).toEqual([]);
    s.dismiss(id);
    expect(l).toHaveBeenCalledTimes(2);
  });
});

describe('putLayoutKeepalive', () => {
  it('sends PUT /api/layout with keepalive and CSRF header, no refetch', () => {
    const { m, calls, fetchFn } = setup([json(200, {})]);
    const layout = [{ i: 'a', x: 0, y: 0, w: 3, h: 7 }];
    m.putLayoutKeepalive(layout);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/layout');
    expect(calls[0]!.init.method).toBe('PUT');
    expect(calls[0]!.init.keepalive).toBe(true);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(layout);
    expect((calls[0]!.init.headers as Record<string, string>)['X-Crontick-Dashboard']).toBe('1');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
