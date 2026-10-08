export const FEED_DEBOUNCE_MS = 200;
export const FEED_RESCAN_MS = 10_000;
/** Cumulative delays (from first sight) at which a possibly half-written file is re-read. */
export const FEED_SETTLE_DELAYS_MS = [250, 1000, 3000] as const;
