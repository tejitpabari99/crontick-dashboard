import { useSyncExternalStore } from 'react';
import { createClient, type Client } from './client.ts';
import type { Snapshot } from './types.ts';

export const DEFAULT_POLL_MS = 30_000;
export const MIN_POLL_MS = 15_000;
export const MAX_POLL_MS = 60_000;
export const HIDDEN_POLL_MS = 60_000;

/** Retry delays (ms) while the server is down: 5 s, then 10 s, then 30 s. */
export const DOWN_BACKOFF_MS = [5_000, 10_000, 30_000] as const;
/** Consecutive failures that flip the UI to the Server down page. */
export const DOWN_AFTER_FAILURES = 2;

export function clampPollInterval(ms: number | undefined): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return DEFAULT_POLL_MS;
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, ms));
}

export interface StoreState {
  snapshot: Snapshot | null;
  /** A fetch is in flight. */
  loading: boolean;
  /** At least one successful load (200 or 304 after a 200). */
  loaded: boolean;
  /** ms epoch of last successful fetch (200 or 304), or null. */
  lastSuccessAt: number | null;
  /** Failures since last success; reset on success. */
  consecutiveFailures: number;
  /** Current poll interval (ms) in effect while visible. */
  pollIntervalMs: number;
  /** Server considered down: snapshot is dropped and nothing cached is shown. */
  serverDown: boolean;
  /** Retry delay (ms) in effect while `serverDown`. */
  retryMs: number;
}

export interface VisibilityDoc {
  visibilityState: string;
  addEventListener(type: 'visibilitychange', cb: () => void): void;
  removeEventListener(type: 'visibilitychange', cb: () => void): void;
}

export interface StoreOptions {
  client?: Client;
  doc?: VisibilityDoc;
  now?: () => number;
  setTimeout?: (cb: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
}

export interface SnapshotStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): StoreState;
  /** Fetch now (resets the poll timer). Never rejects; failures are recorded in state. */
  refetch(): Promise<void>;
}

/** Return `prev` when deep-equal to `next`; otherwise reuse unchanged subtrees. */
export function shareStructure<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return next;
  if (Array.isArray(next)) {
    if (!Array.isArray(prev)) return next;
    const out = next.map((v, i) => shareStructure(prev[i], v));
    return (out.length === prev.length && out.every((v, i) => v === prev[i]) ? prev : out) as T;
  }
  if (next && typeof next === 'object') {
    if (!prev || typeof prev !== 'object' || Array.isArray(prev)) return next;
    const p = prev as Record<string, unknown>;
    const n = next as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(n)) out[k] = shareStructure(p[k], n[k]);
    const same =
      Object.keys(out).length === Object.keys(p).length && Object.keys(out).every((k) => out[k] === p[k]);
    return (same ? prev : out) as T;
  }
  return next;
}

export function createSnapshotStore(opts: StoreOptions = {}): SnapshotStore {
  const client = opts.client ?? createClient();
  const now = opts.now ?? (() => Date.now());
  const setT = opts.setTimeout ?? ((cb, ms) => globalThis.setTimeout(cb, ms));
  const clearT = opts.clearTimeout ?? ((h) => globalThis.clearTimeout(h as number));
  const doc: VisibilityDoc | undefined = opts.doc ?? (typeof document === 'undefined' ? undefined : document);

  let state: StoreState = {
    snapshot: null,
    loading: false,
    loaded: false,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    pollIntervalMs: DEFAULT_POLL_MS,
    serverDown: false,
    retryMs: DOWN_BACKOFF_MS[0],
  };
  let downFailures = 0;
  let etag: string | null = null;
  let timer: unknown = null;
  let inflight: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const isHidden = (): boolean => doc?.visibilityState === 'hidden';
  const set = (patch: Partial<StoreState>): void => {
    state = { ...state, ...patch };
    for (const l of [...listeners]) l();
  };

  function clearTimer(): void {
    if (timer !== null) clearT(timer);
    timer = null;
  }

  function schedule(): void {
    clearTimer();
    if (listeners.size === 0) return;
    const delay = state.serverDown ? state.retryMs : isHidden() ? HIDDEN_POLL_MS : state.pollIntervalMs;
    timer = setT(() => void refetch(), delay);
  }

  async function doFetch(): Promise<void> {
    set({ loading: true });
    try {
      const r = await client.getSnapshot(etag);
      if (r.status === 'ok') {
        etag = r.etag;
        const snapshot = shareStructure(state.snapshot, r.snapshot);
        set({
          snapshot,
          loading: false,
          loaded: true,
          lastSuccessAt: now(),
          consecutiveFailures: 0,
          pollIntervalMs: clampPollInterval(snapshot.config?.pollIntervalMs),
          serverDown: false,
          retryMs: DOWN_BACKOFF_MS[0],
        });
        downFailures = 0;
      } else {
        set({
          loading: false,
          loaded: state.snapshot !== null,
          lastSuccessAt: now(),
          consecutiveFailures: 0,
          serverDown: false,
          retryMs: DOWN_BACKOFF_MS[0],
        });
        downFailures = 0;
      }
    } catch {
      const failures = state.consecutiveFailures + 1;
      const stale = state.lastSuccessAt !== null && now() - state.lastSuccessAt > 2 * state.pollIntervalMs;
      if (state.serverDown || failures >= DOWN_AFTER_FAILURES || !state.loaded || stale) {
        downFailures = state.serverDown ? downFailures + 1 : 0;
        // Drop everything cached: nothing stale may stay visible while the server is down.
        etag = null;
        set({
          snapshot: null,
          loading: false,
          loaded: false,
          consecutiveFailures: failures,
          serverDown: true,
          retryMs: DOWN_BACKOFF_MS[Math.min(downFailures, DOWN_BACKOFF_MS.length - 1)]!,
        });
      } else {
        set({ loading: false, consecutiveFailures: failures });
      }
    }
  }

  function refetch(): Promise<void> {
    clearTimer();
    inflight ??= doFetch().finally(() => {
      inflight = null;
      schedule();
    });
    return inflight;
  }

  const onVisibility = (): void => {
    if (isHidden()) schedule();
    else void refetch();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        doc?.addEventListener('visibilitychange', onVisibility);
        void refetch();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          doc?.removeEventListener('visibilitychange', onVisibility);
          clearTimer();
        }
      };
    },
    getSnapshot: () => state,
    refetch,
  };
}

let defaultStore: SnapshotStore | null = null;
export function getSnapshotStore(): SnapshotStore {
  return (defaultStore ??= createSnapshotStore());
}

export function useSnapshotState(store: SnapshotStore = getSnapshotStore()): StoreState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
