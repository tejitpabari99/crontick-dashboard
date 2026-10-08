import { ERROR_CODES } from '../../src/constants/error-codes.ts';
import { JSON_CONTENT_TYPE, MUTATION_HEADER, MUTATION_HEADER_VALUE } from '../../src/constants/http.ts';
import { POLL_DEFAULT_MS } from '../../src/constants/poll.ts';
import { describe, expect, it, vi } from 'vitest';
import { createClient } from '../src/api/client.ts';
import { createSnapshotStore } from '../src/api/store.ts';
import { createMutations } from '../src/api/mutations.ts';
import { CONFLICT_TOAST } from '../src/constants/messages.ts';
import { createToastStore } from '../src/api/toasts.ts';
import type { Snapshot } from '../src/api/types.ts';

const card = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  type: 'list',
  title: id.toUpperCase(),
  priority: 1,
  notify: false,
  updatedAt: '2026-01-01T00:00:00Z',
  column: 'left',
  height: 'M',
  status: 'ok',
  collapsed: false,
  done: false,
  ...over,
});

const snap = (over: Partial<Snapshot> = {}): Snapshot =>
  ({
    serverTime: 't',
    rev: 'r1',
    warnings: [],
    config: { pollIntervalMs: POLL_DEFAULT_MS, nowPriorityThreshold: 5 },
    columns: { left: ['a', 'b'], center: ['c'], right: [] },
    now: ['n'],
    alerts: ['al'],
    hidden: ['h'],
    completed: [{ kind: 'card', id: 'd' }],
    cards: {
      a: card('a', { checked: ['d1'], data: { items: [{ id: 'i1', checked: true }, { id: 'i2' }, { id: 'i3' }] } }),
      b: card('b', { updatedAt: 'x' }),
      c: card('c', { column: 'center' }),
      n: card('n', { priority: 9 }),
      h: card('h'),
      d: card('d', { done: true, doneAt: '2026-01-02T00:00:00Z' }),
    },
    alertItems: { al: { id: 'al', title: 'AL', priority: 1, updatedAt: 'x', status: 'ok' } },
    completedAlertItems: {},
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
  it('done: optimistic patch, headers, refetch, then settled', async () => {
    const t = setup([json(200, { rev: 'r2' })]);
    await t.store.refetch();
    const p = t.m.done('a');
    const s = t.m.getView().state.snapshot!;
    expect(s.columns.left).toEqual(['b']);
    expect(s.completed).toEqual([{ kind: 'card', id: 'a' }, { kind: 'card', id: 'd' }]);
    expect(s.cards.a!.done).toBe(true);
    expect(s.columns.center).toEqual(['c']);
    t.setCurrent(snap({ columns: { left: ['b'], center: ['c'], right: [] } }));
    await p;
    expect(t.calls[0]!.url).toBe('/api/cards/a/done');
    expect(t.calls[0]!.init.method).toBe('POST');
    expect(t.calls[0]!.init.headers).toEqual({
      'Content-Type': JSON_CONTENT_TYPE,
      [MUTATION_HEADER]: MUTATION_HEADER_VALUE,
    });
    expect(t.toasts.getSnapshot()).toEqual([]);
  });

  it('done removes from now and columns.*', async () => {
    const t = setup([new Promise<Response>(() => undefined)]);
    await t.store.refetch();
    void t.m.done('n');
    expect(t.m.getView().state.snapshot!.now).toEqual([]);
    void t.m.done('c');
    expect(t.m.getView().state.snapshot!.columns.center).toEqual([]);
  });

  it('reopen: DELETE /done; leaves completed + done=false, card not re-added until refetch', async () => {
    let release!: (r: Response) => void;
    const t = setup([new Promise<Response>((r) => (release = r))]);
    await t.store.refetch();
    const p = t.m.reopen('d');
    const s = t.m.getView().state.snapshot!;
    expect(s.completed).toEqual([]);
    expect(s.cards.d!.done).toBe(false);
    expect([...s.now, ...s.columns.left, ...s.columns.center, ...s.columns.right]).not.toContain('d');
    await vi.waitFor(() => expect(t.calls).toHaveLength(1));
    expect(t.calls[0]!.url).toBe('/api/cards/d/done');
    expect(t.calls[0]!.init.method).toBe('DELETE');
    t.setCurrent(snap({ completed: [], columns: { left: ['a', 'b', 'd'], center: ['c'], right: [] } }));
    release(json(200, {}));
    await p;
    expect(t.m.getView().state.snapshot!.columns.left).toEqual(['a', 'b', 'd']);
  });

  it('mutation during an in-flight poll: waits and refetches fresh, patch is not dropped by stale data', async () => {
    const before = snap();
    const after = snap({ columns: { left: ['b'], center: ['c'], right: [] }, completed: [{ kind: 'card', id: 'a' }] });
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
    expect(m.getView().state.snapshot?.columns.left).toEqual(['b']); // optimistic patch still applied
    await p;
    expect(gets).toBe(2);
    expect(m.getView().state.snapshot?.columns.left).toEqual(['b']);
  });

  it('hide: removes from now/columns, adds to hidden; 500 rolls back and toasts', async () => {
    const t = setup([json(500, { error: 'disk full' })]);
    await t.store.refetch();
    const p = t.m.hide('a');
    const s = t.m.getView().state.snapshot!;
    expect(s.hidden).toEqual(['h', 'a']);
    expect(s.columns.left).toEqual(['b']);
    await p;
    const r = t.m.getView().state.snapshot!;
    expect(r.hidden).toEqual(['h']);
    expect(r.columns.left).toEqual(['a', 'b']);
    expect(t.toasts.getSnapshot().map((x) => x.message)).toEqual(['disk full']);
  });

  it('unhide: removes from hidden only (card absent from columns until refetch)', async () => {
    let release!: (r: Response) => void;
    const t = setup([new Promise<Response>((r) => (release = r))]);
    await t.store.refetch();
    const p = t.m.unhide('h');
    const s = t.m.getView().state.snapshot!;
    expect(s.hidden).toEqual([]);
    expect([...s.now, ...s.columns.left, ...s.columns.center, ...s.columns.right]).not.toContain('h');
    await vi.waitFor(() => expect(t.calls).toHaveLength(1));
    expect(t.calls[0]!.url).toBe('/api/cards/h/hidden');
    expect(t.calls[0]!.init.method).toBe('DELETE');
    release(json(200, {}));
    await p;
  });

  it('409: reverts, silently refetches, toasts "card updated, try again"', async () => {
    const t = setup([json(409, { error: 'card updated', code: ERROR_CODES.CARD_CHANGED })]);
    await t.store.refetch();
    const before = t.fetchFn.mock.calls.filter((c) => c[0] === '/api/snapshot').length;
    await t.m.tick('al');
    expect(t.m.getView().state.snapshot?.alerts).toEqual(['al']);
    expect(t.toasts.getSnapshot().map((x) => x.message)).toEqual([CONFLICT_TOAST]);
    await vi.waitFor(() =>
      expect(t.fetchFn.mock.calls.filter((c) => c[0] === '/api/snapshot').length).toBeGreaterThan(before),
    );
  });

  it('tick optimistically removes the alert from alerts only', async () => {
    let release!: (r: Response) => void;
    const t = setup([new Promise<Response>((r) => (release = r))]);
    await t.store.refetch();
    const p = t.m.tick('al');
    const s = t.m.getView().state.snapshot!;
    expect(s.alerts).toEqual([]);
    expect(s.completed).toEqual([{ kind: 'card', id: 'd' }]);
    await vi.waitFor(() => expect(t.calls).toHaveLength(1));
    expect(t.calls[0]!.url).toBe('/api/alerts/al/tick');
    expect(t.calls[0]!.init.method).toBe('POST');
    release(json(200, {}));
    await p;
  });

  it('network failure rolls back and toasts', async () => {
    const t = setup([new Error('boom')]);
    await t.store.refetch();
    await t.m.unhide('h');
    expect(t.toasts.getSnapshot()).toHaveLength(1);
    expect(t.m.getView().state.snapshot?.hidden).toEqual(['h']);
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

  it('409 without a CARD_CHANGED code shows the server message, not the conflict toast', async () => {
    const t = setup([json(409, { error: 'other conflict', code: 'SOMETHING_ELSE' })]);
    await t.m.tick('al').catch(() => undefined);
    expect(t.toasts.getSnapshot().map((x) => x.message)).toEqual(['other conflict']);
  });

  it('onItemAction 409 rejects and toasts conflict text', async () => {
    const t = setup([json(409, { error: 'card updated', code: ERROR_CODES.CARD_CHANGED })]);
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
