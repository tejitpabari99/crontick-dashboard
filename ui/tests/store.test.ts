import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '../src/api/client.ts';
import { clampPollInterval, createSnapshotStore } from '../src/api/store.ts';
import type { Snapshot } from '../src/api/types.ts';

function snap(rev: string, pollIntervalMs = 30000, extra: Record<string, unknown> = {}): Snapshot {
  return {
    serverTime: 't',
    rev,
    warnings: [],
    config: { pollIntervalMs, nowPriorityThreshold: 5 },
    zones: {},
    cards: {
      a: { id: 'a', title: 'A', ...extra },
      b: { id: 'b', title: 'B' },
    },
    layout: [],
  } as unknown as Snapshot;
}

function res(status: number, body?: unknown, etag?: string): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: etag ? { ETag: etag } : {},
  });
}

class FakeDoc extends EventTarget {
  visibilityState: 'visible' | 'hidden' = 'visible';
  set(v: 'visible' | 'hidden'): void {
    this.visibilityState = v;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(responses: Array<Response | Error>) {
  const fetchFn = vi.fn<typeof fetch>(async () => {
    const r = responses.shift();
    if (!r) throw new Error('no more responses');
    if (r instanceof Error) throw r;
    return r;
  });
  const doc = new FakeDoc();
  const store = createSnapshotStore({
    client: createClient({ fetch: fetchFn }),
    doc,
  });
  return { fetchFn, doc, store };
}

describe('client', () => {
  it('sends If-None-Match and treats 304 as not-modified', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => res(304));
    const c = createClient({ fetch: fetchFn });
    expect(await c.getSnapshot('"r1"')).toEqual({ status: 'not-modified' });
    const init = fetchFn.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['If-None-Match']).toBe('"r1"');
  });
  it('returns snapshot + etag on 200, throws on 500', async () => {
    const f1 = vi.fn<typeof fetch>(async () => res(200, snap('r1'), '"r1"'));
    const r = await createClient({ fetch: f1 }).getSnapshot();
    expect(r.status === 'ok' && r.etag).toBe('"r1"');
    const f2 = vi.fn<typeof fetch>(async () => res(500, { error: 'x' }));
    await expect(createClient({ fetch: f2 }).getSnapshot()).rejects.toThrow();
  });
});

describe('clampPollInterval', () => {
  it('clamps to 15-60 s, defaults 30 s', () => {
    expect(clampPollInterval(1000)).toBe(15000);
    expect(clampPollInterval(999999)).toBe(60000);
    expect(clampPollInterval(20000)).toBe(20000);
    expect(clampPollInterval(undefined)).toBe(30000);
    expect(clampPollInterval(NaN)).toBe(30000);
  });
});

describe('store', () => {
  it('polls every 30 s before load info, uses ETag, 304 keeps state identity', async () => {
    const { fetchFn, store } = setup([res(200, snap('r1'), '"r1"'), res(304), res(304)]);
    const seen = vi.fn();
    store.subscribe(seen);
    await vi.advanceTimersByTimeAsync(0);
    const s1 = store.getSnapshot();
    expect(s1.snapshot?.rev).toBe('r1');
    expect(s1.lastSuccessAt).not.toBeNull();
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const init = fetchFn.mock.calls[1]![1]!;
    expect((init.headers as Record<string, string>)['If-None-Match']).toBe('"r1"');
    expect(store.getSnapshot().snapshot).toBe(s1.snapshot);
  });

  it('first poll is scheduled 30 s after a failed first load', async () => {
    const { fetchFn, store } = setup([new Error('down'), res(200, snap('r1'), '"r1"')]);
    store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().consecutiveFailures).toBe(1);
    expect(store.getSnapshot().snapshot).toBeNull();
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().consecutiveFailures).toBe(0);
  });

  it('uses clamped config interval', async () => {
    const { fetchFn, store } = setup([res(200, snap('r1', 1000), '"r1"'), res(304), res(304)]);
    store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(14999);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('structural sharing keeps unchanged card identity', async () => {
    const { store } = setup([res(200, snap('r1'), '"r1"'), res(200, snap('r2', 30000, { title: 'A2' }), '"r2"')]);
    store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const first = store.getSnapshot().snapshot!;
    await vi.advanceTimersByTimeAsync(30000);
    const second = store.getSnapshot().snapshot!;
    expect(second.rev).toBe('r2');
    expect(second.cards['b']).toBe(first.cards['b']);
    expect(second.cards['a']).not.toBe(first.cards['a']);
  });

  it('pauses to a 60 s slow tick while hidden, refetches immediately on visible', async () => {
    const { fetchFn, doc, store } = setup([
      res(200, snap('r1'), '"r1"'),
      res(304),
      res(304),
      res(304),
    ]);
    store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    doc.set('hidden');
    await vi.advanceTimersByTimeAsync(59999);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    doc.set('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('refetch() fetches now; tracks failures; stops on last unsubscribe', async () => {
    const { fetchFn, store } = setup([res(200, snap('r1'), '"r1"'), new Error('x'), new Error('y')]);
    const unsub = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    await store.refetch();
    await store.refetch();
    expect(store.getSnapshot().consecutiveFailures).toBe(2);
    expect(store.getSnapshot().lastSuccessAt).not.toBeNull();
    unsub();
    await vi.advanceTimersByTimeAsync(120000);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});
