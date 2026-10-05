/** Injectable timers (fake in tests). Consumers should depend on the narrowest `Pick` they use. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export type TimeoutTimers = Pick<Timers, 'setTimeout' | 'clearTimeout'>;
export type IntervalTimers = Pick<Timers, 'setInterval' | 'clearInterval'>;

type Unrefable = { unref?: () => unknown };

/** Real timers. Handles are unref'd so a pending timer never keeps the process alive on its own. */
export const realTimers: Timers = {
  setTimeout: (fn, ms) => {
    const h = setTimeout(fn, ms);
    (h as Unrefable).unref?.();
    return h;
  },
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
  setInterval: (fn, ms) => {
    const h = setInterval(fn, ms);
    (h as Unrefable).unref?.();
    return h;
  },
  clearInterval: (h) => clearInterval(h as NodeJS.Timeout),
};
