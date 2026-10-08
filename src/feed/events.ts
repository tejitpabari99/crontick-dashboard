/**
 * Card events (the extension hook for 05-notifications).
 *
 * Wire `onChange` into createFeedIngest's `onChange`. For `new`/`changed` it emits `card:new` /
 * `card:changed` only when the card is non-Broken (status ok, no `error`, not stale), inside its show
 * window (config timezone), and its `updatedAt` differs from `state.notified[id]`; afterwards it stamps
 * `notified[id]`. Because the startup scan reports every card as `new`, restarts re-emit only cards that
 * changed while down. Server write-backs (`change.selfWrite`) never fire or stamp.
 * Suppressed (broken / out-of-window) cards are NOT stamped.
 *
 * `card:removed` semantics: fires when a previously ok, non-Broken card disappears from the store
 * (file deleted/moved, e.g. tick). Not gated by window or `notified`; payload = the last view.
 * A card turning into a Broken file emits nothing.
 */
import type { Clock } from '../clock.js';
import { brokenReason, inWindow } from '../compute/snapshot.js';
import type { StateStore } from '../state/store.js';
import type { Warnings } from '../state/warnings.js';
import { sameInstant } from '../instant.js';
import type { AlertChange, AlertEntry, CardChange, CardEntry } from './ingest.js';
import { errorMessage } from '../utils/errors.js';

export type CardEventType = 'card:new' | 'card:changed' | 'card:removed';
/**
 * Small view object carried by every event (what the notifier needs; never the whole card).
 * `type`/`data` are set for panels, `text` for alerts.
 */
export interface CardEventPayload {
  kind: 'panel' | 'alert';
  /** Card id, or alert id (file stem). */
  id: string;
  title: string;
  priority: number;
  notify: boolean;
  type?: string;
  data?: Record<string, unknown>;
  text?: string;
  /** Watcher-relative path of the file that changed. */
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
  /** Pass to createFeedIngest({ onAlertChange }). */
  onAlertChange(change: AlertChange): void;
  /** Resolves when pending `notified` stamps are persisted. */
  flush(): Promise<void>;
}

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

  function notifiable(c: { updatedAt: string; error?: string | null; staleAfter?: string; show?: { cron: string; for?: string } }): boolean {
    const now = opts.clock.now();
    return brokenReason(c, now) === null && inWindow(c.show, now, opts.getTimezone());
  }

  function stamp(id: string, updatedAt: string): void {
    const p = opts.state
      .setNotified(id, updatedAt)
      .then(() => opts.warnings?.clear('notified'))
      .catch((err: unknown) => opts.warnings?.set('notified', `could not persist notified state: ${errorMessage(err)}`))
      .finally(() => void pending.delete(p));
    pending.add(p);
  }

  /** True when `key` was already notified for this instant (so nothing fires). */
  function alreadyNotified(key: string, updatedAt: string): boolean {
    const st = opts.state.get();
    const last = Object.hasOwn(st.notified, key) ? st.notified[key] : undefined;
    return last !== undefined && sameInstant(last, updatedAt);
  }

  function panelView(e: CardEntry | undefined): CardEventPayload | undefined {
    if (e?.status !== 'ok') return undefined;
    const c = e.card;
    return {
      kind: 'panel',
      id: c.id,
      title: c.title,
      priority: c.priority,
      notify: c.notify,
      type: c.type,
      ...(c.data !== undefined ? { data: c.data } : {}),
      file: e.file,
    };
  }

  function alertView(e: AlertEntry | undefined): CardEventPayload | undefined {
    if (e?.status !== 'ok') return undefined;
    const a = e.alert;
    return {
      kind: 'alert',
      id: a.id,
      title: a.title,
      priority: a.priority,
      notify: a.notify,
      ...(a.text !== undefined ? { text: a.text } : {}),
      file: e.file,
    };
  }

  return {
    events,
    onChange(change) {
      if (change.selfWrite) return; // server write-backs never fire events
      if (change.type === 'removed') {
        const e = change.prev;
        const view = panelView(e);
        if (view && e?.status === 'ok' && brokenReason(e.card, opts.clock.now()) === null) emit('card:removed', view);
        return;
      }
      if (!change.contentChanged) return; // card.json-only edits re-render but never notify
      const e = change.entry;
      const view = panelView(e);
      if (!view || e?.status !== 'ok') return;
      const updatedAt = e.card.updatedAt;
      if (alreadyNotified(change.key, updatedAt)) return;
      if (!notifiable(e.card)) return;
      // First time it is visible as an ok card (new, or card.json-only/broken before) counts as new.
      emit(change.type === 'new' || change.prev?.status !== 'ok' ? 'card:new' : 'card:changed', view);
      stamp(change.key, updatedAt);
    },
    /**
     * Alerts: a new/changed valid alert file (content hash changed, so `contentChanged`) fires `card:new` /
     * `card:changed` with kind 'alert' when inside its show window. Dedupe identity is the alert's effective
     * `updatedAt` (explicit, else file mtime) under `notified['alert:<id>']`: rewriting with a new updatedAt
     * or mtime notifies once; identical bytes or the same explicit updatedAt do not. Broken alerts, removals
     * and `.done/` files (never reported by ingest) never notify.
     */
    onAlertChange(change: AlertChange) {
      if (change.type === 'removed' || !change.contentChanged) return;
      const e = change.entry;
      const view = alertView(e);
      if (!view || e?.status !== 'ok') return;
      const key = `alert:${change.key}`;
      const updatedAt = e.alert.updatedAt;
      if (alreadyNotified(key, updatedAt)) return;
      if (!notifiable({ updatedAt, show: e.alert.show })) return;
      emit(change.type === 'new' ? 'card:new' : 'card:changed', view);
      stamp(key, updatedAt);
    },
    async flush() {
      while (pending.size) await Promise.all([...pending]);
    },
  };
}
