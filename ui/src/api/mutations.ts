import { useSyncExternalStore } from 'react';
import type { LayoutItem, Snapshot, ViewCard } from './types.ts';
import { getSnapshotStore, type SnapshotStore, type StoreState } from './store.ts';
import { getToastStore, type ToastStore } from './toasts.ts';

export const CONFLICT_TOAST = 'card updated, try again';

type Op =
  | { id: number; kind: 'zone'; cardId: string; zone: 'tray' | 'hidden' | 'restore' }
  | { id: number; kind: 'layout'; layout: LayoutItem[] }
  | { id: number; kind: 'item'; cardId: string; itemId: string; checked: boolean };

export interface MutationView {
  /** Store state with optimistic patches applied. */
  state: StoreState;
  /** Item ids with an action request in flight, per card. */
  pending: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface Mutations {
  subscribe(listener: () => void): () => void;
  getView(): MutationView;
  /** Union of item.checked (data), snapshot `checked` ids and optimistic ticks/unticks. */
  getChecked(cardId: string): ReadonlySet<string>;
  getPending(cardId: string): ReadonlySet<string>;
  done(cardId: string): Promise<void>;
  undone(cardId: string): Promise<void>;
  hide(cardId: string): Promise<void>;
  unhide(cardId: string): Promise<void>;
  tick(cardId: string): Promise<void>;
  putLayout(layout: LayoutItem[]): Promise<void>;
  /** Fire-and-forget PUT with `keepalive` for `pagehide`; no optimistic patch, no refetch, never throws. */
  putLayoutKeepalive(layout: LayoutItem[]): void;
  /** Resolves on success, rejects with the server message. */
  onItemAction(cardId: string, itemId: string, checked?: boolean): Promise<void>;
}

export interface MutationOptions {
  store?: SnapshotStore;
  toasts?: ToastStore;
  fetch?: typeof fetch;
  baseUrl?: string;
}

const ZONES = ['alerts', 'now', 'grid', 'tray', 'hidden'] as const;

function without(list: string[] | undefined, id: string): string[] {
  return (list ?? []).filter((x) => x !== id);
}

function applyZone(snap: Snapshot, cardId: string, zone: 'tray' | 'hidden' | 'restore'): Snapshot {
  const zones: Record<string, string[]> = {};
  for (const z of ZONES) zones[z] = without(snap.zones?.[z], cardId);
  if (zone === 'restore') {
    const kind = snap.cards[cardId]?.kind;
    const target = kind === 'alert' ? 'alerts' : 'grid';
    zones[target] = [...zones[target]!, cardId];
  } else {
    zones[zone] = [...zones[zone]!, cardId];
  }
  return { ...snap, zones: zones as unknown as Snapshot['zones'] };
}

function baseChecked(card: ViewCard | undefined): Set<string> {
  const out = new Set<string>(card?.checked ?? []);
  const items = card?.data?.items;
  if (Array.isArray(items)) {
    for (const it of items as Array<{ id?: unknown; checked?: unknown }>) {
      if (it && typeof it.id === 'string' && it.checked) out.add(it.id);
    }
  }
  return out;
}

export function createMutations(opts: MutationOptions = {}): Mutations {
  const store = opts.store ?? getSnapshotStore();
  const toasts = opts.toasts ?? getToastStore();
  const base = opts.baseUrl ?? '';
  const doFetch = (u: string, i: RequestInit): Promise<Response> =>
    (opts.fetch ?? globalThis.fetch.bind(globalThis))(u, i);

  let ops: Op[] = [];
  let seq = 1;
  const listeners = new Set<() => void>();
  let cachedFor: { state: StoreState; ops: Op[] } | null = null;
  let cached: MutationView | null = null;

  const emit = (): void => {
    for (const l of [...listeners]) l();
  };

  function compute(state: StoreState): MutationView {
    let snapshot = state.snapshot;
    const pending = new Map<string, Set<string>>();
    for (const op of ops) {
      if (op.kind === 'item') {
        let s = pending.get(op.cardId);
        if (!s) pending.set(op.cardId, (s = new Set()));
        s.add(op.itemId);
      } else if (snapshot) {
        snapshot = op.kind === 'zone' ? applyZone(snapshot, op.cardId, op.zone) : { ...snapshot, layout: op.layout };
      }
    }
    return { state: snapshot === state.snapshot ? state : { ...state, snapshot }, pending };
  }

  function getView(): MutationView {
    const state = store.getSnapshot();
    if (cached && cachedFor && cachedFor.state === state && cachedFor.ops === ops) return cached;
    cachedFor = { state, ops };
    return (cached = compute(state));
  }

  const EMPTY: ReadonlySet<string> = new Set();

  function removeOp(id: number): void {
    ops = ops.filter((o) => o.id !== id);
    emit();
  }

  async function run(
    method: string,
    path: string,
    body: unknown,
    op: Op,
    errorToast?: (msg: string) => string,
  ): Promise<void> {
    ops = [...ops, op];
    emit();
    let failure: { status: number; message: string } | null = null;
    try {
      const res = await doFetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Crontick-Dashboard': '1' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try {
          const j = (await res.json()) as { error?: unknown };
          if (typeof j.error === 'string' && j.error) message = j.error;
        } catch {
          /* keep default */
        }
        failure = { status: res.status, message };
      }
    } catch (e) {
      failure = { status: 0, message: e instanceof Error ? e.message : 'Network error' };
    }
    if (failure) {
      removeOp(op.id);
      toasts.push(failure.status === 409 ? CONFLICT_TOAST : (errorToast?.(failure.message) ?? failure.message));
      void store.refetch();
      throw new Error(failure.message);
    }
    // Keep the patch until the refetched snapshot carries the truth.
    await store.refetch();
    removeOp(op.id);
  }

  /** Public wrapper: toast already shown; the promise still rejects for callers that care. */
  const swallow = (p: Promise<void>): Promise<void> => p.catch(() => undefined);
  const zoneOp = (cardId: string, zone: 'tray' | 'hidden' | 'restore'): Op => ({ id: seq++, kind: 'zone', cardId, zone });
  const enc = encodeURIComponent;

  return {
    subscribe(listener) {
      listeners.add(listener);
      const off = store.subscribe(listener);
      return () => {
        listeners.delete(listener);
        off();
      };
    },
    getView,
    getChecked(cardId) {
      const card = store.getSnapshot().snapshot?.cards[cardId];
      const out = baseChecked(card);
      for (const op of ops) {
        if (op.kind === 'item' && op.cardId === cardId) {
          if (op.checked) out.add(op.itemId);
          else out.delete(op.itemId);
        }
      }
      return out.size === 0 ? EMPTY : out;
    },
    getPending: (cardId) => getView().pending.get(cardId) ?? EMPTY,
    done: (id) => swallow(run('POST', `/api/cards/${enc(id)}/done`, undefined, zoneOp(id, 'tray'))),
    undone: (id) => swallow(run('DELETE', `/api/cards/${enc(id)}/done`, undefined, zoneOp(id, 'restore'))),
    hide: (id) => swallow(run('PUT', `/api/cards/${enc(id)}/hidden`, undefined, zoneOp(id, 'hidden'))),
    unhide: (id) => swallow(run('DELETE', `/api/cards/${enc(id)}/hidden`, undefined, zoneOp(id, 'restore'))),
    tick: (id) => swallow(run('POST', `/api/alerts/${enc(id)}/tick`, undefined, zoneOp(id, 'tray'))),
    putLayout: (layout) => swallow(run('PUT', '/api/layout', layout, { id: seq++, kind: 'layout', layout })),
    putLayoutKeepalive(layout) {
      try {
        void doFetch(`${base}/api/layout`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Crontick-Dashboard': '1' },
          body: JSON.stringify(layout),
          keepalive: true,
        }).catch(() => undefined);
      } catch {
        /* page is going away */
      }
    },
    onItemAction(cardId, itemId, checked = true) {
      const card = store.getSnapshot().snapshot?.cards[cardId];
      return run(
        'POST',
        `/api/cards/${enc(cardId)}/actions`,
        { itemId, updatedAt: card?.updatedAt ?? '', checked },
        { id: seq++, kind: 'item', cardId, itemId, checked },
      );
    },
  };
}

let defaultMutations: Mutations | null = null;
export function getMutations(): Mutations {
  return (defaultMutations ??= createMutations());
}

export function useMutationView(m: Mutations = getMutations()): MutationView {
  return useSyncExternalStore(m.subscribe, m.getView);
}
