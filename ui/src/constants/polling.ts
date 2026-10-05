export const HIDDEN_POLL_MS = 60_000;

/** Retry delays (ms) while the server is down: 5 s, then 10 s, then 30 s. */
export const DOWN_BACKOFF_MS = [5_000, 10_000, 30_000] as const;
/** Consecutive failures that flip the UI to the Server down page. */
export const DOWN_AFTER_FAILURES = 2;
