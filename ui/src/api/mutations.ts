import { JSON_CONTENT_TYPE, MUTATION_HEADER, MUTATION_HEADER_VALUE } from '../../../src/constants/http.js';
import { ERROR_CODES } from '../../../src/constants/error-codes.js';
import { useSyncExternalStore } from 'react';
import type { Snapshot, ViewCard } from './types.ts';
import { getSnapshotStore, type SnapshotStore, type StoreState } from './store.ts';
import { getToastStore, type ToastStore } from './toasts.ts';

import { CONFLICT_TOAST } from '../constants/messages.ts';

type Op =
  | { id: number; kind: 'flag'; cardId: string; flag: Flag }
  | { id: number; kind: 'item'; cardId: string; itemId: string; checked: boolean };

type Flag = 'done' | 'reopen' | 'hide' | 'unhide' | 'tick';

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
  reopen(cardId: string): Promise<void>;
  hide(cardId: string): Promise<void>;
  unhide(cardId: string): Promise<void>;
  tick(cardId: string): Promise<void>;
  /** Resolves on success, rejects with the server message. */
  onItemAction(cardId: string, itemId: string, checked?: boolean): Promise<void>;
}

export interface MutationOptions {
  store?: SnapshotStore;
  toasts?: ToastStore;
  fetch?: typeof fetch;
  baseUrl?: string;
}

function without(list: readonly string[], id: string): string[] {
  return list.filter((x) => x !== id);
}

/** Optimistic patch per PRD "API client / state". reopen/unhide leave the card to the next refetch. */
function applyFlag(snap: Snapshot, cardId: string, flag: Flag): Snapshot {
  const card = snap.cards[cardId];
  switch (flag) {
    case 'done':
    case 'hide': {
      const columns = {
        left: without(snap.columns.left, cardId),
        center: without(snap.columns.center, cardId),
        right: without(snap.columns.right, cardId),
      };
      const now = without(snap.now, cardId);
      if (flag === 'hide') return { ...snap, columns, now, hidden: [...without(snap.hidden, cardId), cardId] };
      return {
        ...snap,
        columns,
        now,
        completed: [{ kind: 'card', id: cardId }, ...snap.completed.filter((c) => !(c.kind === 'card' && c.id === cardId))],
        cards: card ? { ...snap.cards, [cardId]: { ...card, done: true } } : snap.cards,
      };
    }
    case 'reopen':
      return {
        ...snap,
        completed: snap.completed.filter((c) => !(c.kind === 'card' && c.id === cardId)),
        cards: card ? { ...snap.cards, [cardId]: { ...card, done: false } } : snap.cards,
      };
    case 'unhide':
      return { ...snap, hidden: without(snap.hidden, cardId) };
    case 'tick':
      return { ...snap, alerts: without(snap.alerts, cardId) };
  }
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
    if (state.serverDown) return { state, pending: new Map() };
    let snapshot = state.snapshot;
    const pending = new Map<string, Set<string>>();
    for (const op of ops) {
      if (op.kind === 'item') {
        let s = pending.get(op.cardId);
        if (!s) pending.set(op.cardId, (s = new Set()));
        s.add(op.itemId);
      } else if (snapshot) {
        snapshot = applyFlag(snapshot, op.cardId, op.flag);
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
    errorToast?: (msg: string) => string
  ): Promise<void> {
    ops = [...ops, op];
    emit();
    let failure: { status: number; code?: string; message: string } | null = null;
    try {
      const res = await doFetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': JSON_CONTENT_TYPE, [MUTATION_HEADER]: MUTATION_HEADER_VALUE },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!res.ok) {
        let message = `Request failed (${res.status})`;
        let code: string | undefined;
        try {
          const j = (await res.json()) as { error?: unknown; code?: unknown };
          if (typeof j.error === 'string' && j.error) message = j.error;
          if (typeof j.code === 'string') code = j.code;
        } catch {
          /* keep default */
        }
        failure = code === undefined ? { status: res.status, message } : { status: res.status, code, message };
      }
    } catch (e) {
      failure = { status: 0, message: e instanceof Error ? e.message : 'Network error' };
    }
    if (failure) {
      removeOp(op.id);
      toasts.push(failure.code === ERROR_CODES.CARD_CHANGED ? CONFLICT_TOAST : (errorToast?.(failure.message) ?? failure.message));
      void store.refetch();
      throw new Error(failure.message);
    }
    // Keep the patch until the refetched snapshot carries the truth.
    await store.refetch({ fresh: true });
    removeOp(op.id);
  }

  /** Public wrapper: toast already shown; the promise still rejects for callers that care. */
  const swallow = (p: Promise<void>): Promise<void> => p.catch(() => undefined);
  const flagOp = (cardId: string, flag: Flag): Op => ({ id: seq++, kind: 'flag', cardId, flag });
  const enc = encodeURIComponent;

  return {
    subscribe(listener) {
      listeners.add(listener);
      const off = store.subscribe(() => {
        // Server down: discard optimistic patches, pending sets.
        if (store.getSnapshot().serverDown && ops.length > 0) ops = [];
        listener();
      });
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
    done: (id) => swallow(run('POST', `/api/cards/${enc(id)}/done`, undefined, flagOp(id, 'done'))),
    reopen: (id) => swallow(run('DELETE', `/api/cards/${enc(id)}/done`, undefined, flagOp(id, 'reopen'))),
    hide: (id) => swallow(run('PUT', `/api/cards/${enc(id)}/hidden`, undefined, flagOp(id, 'hide'))),
    unhide: (id) => swallow(run('DELETE', `/api/cards/${enc(id)}/hidden`, undefined, flagOp(id, 'unhide'))),
    tick: (id) => swallow(run('POST', `/api/alerts/${enc(id)}/tick`, undefined, flagOp(id, 'tick'))),
    onItemAction(cardId, itemId, checked = true) {
      const card = store.getSnapshot().snapshot?.cards[cardId];
      return run(
        'POST',
        `/api/cards/${enc(cardId)}/actions`,
        { itemId, updatedAt: card?.updatedAt ?? '', checked },
        { id: seq++, kind: 'item', cardId, itemId, checked }
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
