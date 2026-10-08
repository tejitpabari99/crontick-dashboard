export const FEED_DEBOUNCE_MS = 200;
export const FEED_RESCAN_MS = 10_000;
/** Cumulative delays (from first sight) at which a possibly half-written file is re-read. */
export const FEED_SETTLE_DELAYS_MS = [250, 1000, 3000] as const;
/** Completed (ticked) alerts shown in the snapshot: only those ticked within this age of `now`... */
export const COMPLETED_ALERT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** ...and at most this many (newest first). Older `.done/` files stay on disk. */
export const COMPLETED_ALERT_MAX = 50;
