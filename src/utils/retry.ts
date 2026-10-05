import { errnoCode } from './errors.js';
import { sleep as realSleep } from './sleep.js';

export interface RetryOnBusyOptions {
  /** Total attempts including the first. */
  tries: number;
  /** Delay before retry n (1-based) is `backoffMs * 2 ** (n - 1)`. */
  backoffMs: number;
  /** errno codes that are retried; any other error (or running out of tries) is rethrown. */
  codes?: readonly string[];
  sleep?: (ms: number) => Promise<void>;
}

/** Runs `fn`, retrying with exponential backoff while it throws a transient errno (default EPERM, Windows rename races). */
export async function retryOnBusy<T>(fn: () => T | Promise<T>, opts: RetryOnBusyOptions): Promise<T> {
  const codes = opts.codes ?? ['EPERM'];
  const sleep = opts.sleep ?? realSleep;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const code = errnoCode(err);
      if (code === undefined || !codes.includes(code) || attempt >= opts.tries) throw err;
      await sleep(opts.backoffMs * 2 ** (attempt - 1));
    }
  }
}
