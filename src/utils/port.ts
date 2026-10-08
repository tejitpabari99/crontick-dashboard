import { MAX_PORT, MIN_PORT } from '../constants/http.js';

export interface ParsePortOptions {
  /** Accept 0 (OS-assigned port). */
  allowZero?: boolean;
}

/** Integer port from a number or a decimal string, or undefined if not an integer in range. */
export function parsePort(v: unknown, opts: ParsePortOptions = {}): number | undefined {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\d+$/.test(v)) n = Number(v);
  else return undefined;
  const min = opts.allowZero ? 0 : MIN_PORT;
  return Number.isInteger(n) && n >= min && n <= MAX_PORT ? n : undefined;
}
