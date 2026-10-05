import { MS_PER_DAY, MS_PER_HOUR } from './time.js';

/** Ids absent from the feed for longer than this are pruned from state.json. */
export const STATE_PRUNE_AFTER_MS = 30 * MS_PER_DAY;
/** `lastSeen` is refreshed at most this often. */
export const LAST_SEEN_GRANULARITY_MS = MS_PER_HOUR;
export const RECONCILE_INTERVAL_MS = MS_PER_HOUR;

/** EPERM/EBUSY rename retry (Windows): attempts and base backoff (doubles per attempt). */
export const RENAME_TRIES = 5;
export const STATE_RENAME_BACKOFF_MS = 20;
export const WRITEBACK_RENAME_BACKOFF_MS = 25;
