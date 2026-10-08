/** Action registry: handlers keyed by the item's `action.type` (read from the current card, never the client). */
import { ERROR_CODES, type ErrorCode } from '../constants/error-codes.js';
import type { OkEntry } from '../feed/ingest.js';
import type { StateStore } from '../state/store.js';
import type { Clock } from '../clock.js';
import { sameInstant } from '../instant.js';
import { completeWriteBack } from './writeback.js';

export type ActionType = 'dismiss' | 'complete';

/** One feed entry to re-ingest, by id (never a path). */
export interface FeedRef {
  kind: 'card' | 'alert';
  id: string;
}

export interface ActionRequest {
  entry: OkEntry;
  itemId: string;
  checked: boolean;
  /** Card `updatedAt` the client saw (already verified equal to the entry's as an instant). */
  updatedAt: string;
}

export interface ActionDeps {
  state: StateStore;
  clock: Clock;
  feedDir: string;
  refreshFeed: (ref: FeedRef) => void;
  /** Watcher's file -> hash registry of server writes (self-write detection). */
  selfWrites: Map<string, string>;
  /** Test seams. */
  rename?: (from: string, to: string) => void;
  sleep?: (ms: number) => Promise<void>;
  hooks?: { beforeCompare?: () => void };
}

/** `ok` -> 200 `{rev}`; `error` -> that HTTP status with `{error}`. Thrown errors become 500. */
export type ActionResult = { ok: true } | { ok: false; status: 400 | 404 | 409; error: string; code: ErrorCode };

export type ActionHandler = (req: ActionRequest, deps: ActionDeps) => Promise<ActionResult>;

const dismiss: ActionHandler = async ({ entry, itemId, checked, updatedAt }, { state }) => {
  if (!checked) return { ok: false, status: 400, error: 'dismiss cannot be unchecked; it is a one-way action', code: ERROR_CODES.DISMISS_NOT_UNCHECKABLE };
  const cur = Object.hasOwn(state.get().checks, entry.key) ? state.get().checks[entry.key] : undefined;
  const same = cur !== undefined && sameInstant(cur.updatedAt, updatedAt);
  const items = same ? cur.items : [];
  if (!items.includes(itemId)) await state.setChecks(entry.key, entry.dataVersion, [...items, itemId]);
  return { ok: true };
};

const complete: ActionHandler = completeWriteBack;

export const actionRegistry: Record<ActionType, ActionHandler> = { dismiss, complete };
