import type { TimeoutTimers } from './timers.js';

/** Resolves after `ms`. Unlike `realTimers`, a bare sleep keeps the process alive until it fires. */
export function sleep(ms: number, timers?: TimeoutTimers): Promise<void> {
  if (timers) return new Promise((resolve) => void timers.setTimeout(resolve, ms));
  return new Promise((resolve) => void setTimeout(resolve, ms));
}

