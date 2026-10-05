/**
 * Card events (the extension hook for 05-notifications).
 *
 * Wire `onChange` into createFeedIngest's `onChange`. For `new`/`changed` it emits `card:new` /
 * `card:changed` only when the card is non-Broken (status ok, no `error`, not stale), inside its show
 * window (config timezone), and its `updatedAt` differs from `state.notified[id]`; afterwards it stamps
 * `notified[id]`. Because the startup scan reports every card as `new`, restarts re-emit only cards that
 * changed while down. Server write-backs keep `updatedAt`, so they never fire.
 * Suppressed (broken / out-of-window) cards are NOT stamped.
 *
 * `card:removed` semantics: fires when a previously ok, non-Broken card disappears from the store
 * (file deleted/moved, e.g. tick). Not gated by window or `notified`; payload `{card: <last card>, file}`.
 * A card turning into a Broken file emits nothing.
 */
import type { Clock } from '../clock.js';
import type { Card } from '../contract/validate.js';
import { brokenReason, inWindow } from '../compute/snapshot.js';
import type { StateStore } from '../state/store.js';
import type { Warnings } from '../state/warnings.js';
import type { CardChange, CardEntry } from './ingest.js';

export type CardEventType = 'card:new' | 'card:changed' | 'card:removed';
export interface CardEventPayload {
  card: Card;
  prev?: Card;
  file: string;
}
export type CardEventListener = (payload: CardEventPayload) => void;

export interface CardEvents {
  on(type: CardEventType, fn: CardEventListener): () => void;
  off(type: CardEventType, fn: CardEventListener): void;
}

export interface CardEventsOptions {
  state: Pick<StateStore, 'get' | 'setNotified'>;
  clock: Clock;
  getTimezone: () => string;
  warnings?: Pick<Warnings, 'set' | 'clear'>;
}

export interface CardEventsHandle {
  events: CardEvents;
  /** Pass to createFeedIngest({ onChange }). */
  onChange(change: CardChange): void;
  /** Resolves when pending `notified` stamps are persisted. */
  flush(): Promise<void>;
}

interface Env {
  updatedAt: string;
  error: string | null;
  staleAfter?: string;
  show?: { cron: string; for?: string };
}
const env = (c: Card): Env => c as unknown as Env;
const same = (a: string, b: string): boolean => {
  const x = Date.parse(a);
  return a === b || (!Number.isNaN(x) && x === Date.parse(b));
};

export function createCardEvents(opts: CardEventsOptions): CardEventsHandle {
  const listeners: Record<CardEventType, Set<CardEventListener>> = {
    'card:new': new Set(),
    'card:changed': new Set(),
    'card:removed': new Set(),
  };
  const pending = new Set<Promise<void>>();

  const events: CardEvents = {
    on(type, fn) {
      listeners[type].add(fn);
      return () => void listeners[type].delete(fn);
    },
    off: (type, fn) => void listeners[type].delete(fn),
  };

  function emit(type: CardEventType, payload: CardEventPayload): void {
    for (const fn of [...listeners[type]]) {
      try {
        fn(payload);
      } catch {
        /* a listener must not break others or stamping */
      }
    }
  }

  function notifiable(card: Card): boolean {
    const e = env(card);
    const now = opts.clock.now();
    return brokenReason(e as never, now) === null && inWindow(e.show, now, opts.getTimezone());
  }

  function stamp(id: string, updatedAt: string): void {
    const p = opts.state
      .setNotified(id, updatedAt)
      .then(() => opts.warnings?.clear('notified'))
      .catch((err: unknown) => opts.warnings?.set('notified', `could not persist notified state: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => void pending.delete(p));
    pending.add(p);
  }

  const okCard = (e: CardEntry | undefined): Card | undefined => (e?.status === 'ok' ? e.card : undefined);

  return {
    events,
    onChange(change) {
      if (change.type === 'removed') {
        const card = okCard(change.prev);
        if (card && brokenReason(env(card) as never, opts.clock.now()) === null) emit('card:removed', { card, file: change.file });
        return;
      }
      const card = okCard(change.entry);
      if (!card) return;
      const updatedAt = env(card).updatedAt;
      const st = opts.state.get();
      const last = Object.hasOwn(st.notified, change.key) ? st.notified[change.key] : undefined;
      if (last !== undefined && same(last, updatedAt)) return;
      if (!notifiable(card)) return;
      const prev = okCard(change.prev);
      emit(change.type === 'new' ? 'card:new' : 'card:changed', { card, ...(prev ? { prev } : {}), file: change.file });
      stamp(change.key, updatedAt);
    },
    async flush() {
      while (pending.size) await Promise.all([...pending]);
    },
  };
}
