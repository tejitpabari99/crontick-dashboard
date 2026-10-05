import { z } from 'zod';
import { Cron } from 'croner';

// Pure helpers: no Node-only or DOM APIs.

const DURATION_RE = /^[1-9]\d*(m|h|d|w)$/;
const MAX_DURATION_MS = 3650 * 86_400_000;
const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 } as const;

/** Parse a duration like `30m`, `12h`, `7d`, `2w` to milliseconds. Throws if invalid. */
export function parseDuration(value: string): number {
  if (!DURATION_RE.test(value)) throw new Error(`invalid duration: ${value}`);
  const n = Number(value.slice(0, -1));
  const ms = n * UNIT_MS[value.slice(-1) as keyof typeof UNIT_MS];
  if (!Number.isSafeInteger(ms) || ms > MAX_DURATION_MS) throw new Error(`duration too long: ${value}`);
  return ms;
}

function isDuration(v: string): boolean {
  try {
    parseDuration(v);
    return true;
  } catch {
    return false;
  }
}

export const durationSchema = z
  .string()
  .refine(isDuration, { message: 'duration must match ^[1-9]\\d*(m|h|d|w)$ and be at most 3650d' });

function isCron5(v: string): boolean {
  if (v !== v.trim() || v.startsWith('@')) return false;
  if (v.split(/\s+/).length !== 5) return false;
  try {
    new Cron(v, { paused: true });
    return true;
  } catch {
    return false;
  }
}

export const cronSchema = z
  .string()
  .refine(isCron5, { message: 'must be a standard 5-field cron expression (no aliases, no seconds)' });

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/;

function validDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isRfc3339(v: string): boolean {
  const m = DATETIME_RE.exec(v);
  if (!m) return false;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number) as [
    number, number, number, number, number, number,
  ];
  if (!validDate(y, mo, d) || h > 23 || mi > 59 || s > 60) return false;
  if (m[8] !== undefined && (Number(m[8]) > 23 || Number(m[9]) > 59)) return false;
  return !Number.isNaN(Date.parse(v));
}

function isDateOnly(v: string): boolean {
  const m = DATE_RE.exec(v);
  return !!m && validDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** RFC 3339 timestamp with offset or `Z`. Naive local times are rejected. */
export const timestampSchema = z
  .string()
  .refine(isRfc3339, { message: 'must be an RFC 3339 timestamp with offset or Z' });

/** List `due`: YYYY-MM-DD or RFC 3339 datetime with offset/Z. */
export const dueSchema = z
  .string()
  .refine((v) => isDateOnly(v) || isRfc3339(v), {
    message: 'must be YYYY-MM-DD or an RFC 3339 datetime with offset or Z',
  });

const MAX_LINK = 2048;
const LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'ms-outlook:']);
const BAD_CHARS = /[\u0000-\u001f\u007f\s]/;

function protocolOf(v: string): string | null {
  if (v.length === 0 || v.length > MAX_LINK) return null;
  if (v !== v.trim()) return null;
  try {
    return new URL(v).protocol;
  } catch {
    return null;
  }
}

function isLink(v: string): boolean {
  const p = protocolOf(v);
  if (p === null || !LINK_SCHEMES.has(p)) return false;
  return !BAD_CHARS.test(v);
}

/** Clickable link: http, https, mailto, ms-outlook; at most 2048 chars. */
export const linkSchema = z
  .string()
  .refine(isLink, { message: 'link must be http, https, mailto or ms-outlook and at most 2048 chars' });

function isMediaSrc(v: string): boolean {
  if (v.length === 0 || v !== v.trim()) return false;
  if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(v)) return true;
  const p = protocolOf(v);
  return p === 'http:' || p === 'https:';
}

/** Media `src`: http(s) URL or `data:image/*` only. */
export const mediaSrcSchema = z
  .string()
  .refine(isMediaSrc, { message: 'src must be an http(s) URL or data:image/*' });

export interface ShowWindow {
  cron: string;
  for?: string;
}

/**
 * Is `now` inside the show window? `cron` = window start, `for` = length.
 * `for` omitted = until end of that local day (in `opts.timezone`, default local).
 * `show` undefined = always active.
 */
export function windowActive(
  show: ShowWindow | undefined,
  now: Date,
  opts?: { timezone?: string },
): boolean {
  if (!show) return true;
  const cronOpts = opts?.timezone ? { timezone: opts.timezone } : {};
  let lookbackFrom: Date;
  if (show.for !== undefined) {
    lookbackFrom = new Date(now.getTime() - parseDuration(show.for));
  } else {
    const midnight = new Cron('0 0 * * *', { ...cronOpts, paused: true }).previousRuns(1, new Date(now.getTime() + 1000))[0];
    // midnight is the latest local 00:00 at or before now; fall back to 24h if unavailable
    // look back from midnight - 1ms so a start at exactly 00:00 (exclusive nextRun) still counts
    lookbackFrom = new Date((midnight ?? new Date(now.getTime() - 86_400_000)).getTime() - 1);
  }
  // Window is active iff a start occurrence exists in (lookbackFrom, now].
  const start = new Cron(show.cron, { ...cronOpts, paused: true }).nextRun(lookbackFrom);
  return start !== null && start.getTime() <= now.getTime();
}
