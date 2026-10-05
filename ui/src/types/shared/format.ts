export interface DueInfo {
  label: string;
  overdue: boolean;
}

export function formatNumber(n: number, locale?: string): string {
  return Number.isFinite(n) ? new Intl.NumberFormat(locale).format(n) : '–';
}

function dayKey(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
}

function dayNum(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / 86_400_000);
}

function weekdayDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const wd = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, 12));
  return `${wd} ${d}`;
}

function timeOf(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(ms);
}

/**
 * Relative due label in `tz`. Date-only = calendar day; datetime shows the time when today.
 * Overdue = before now (datetime) or before today (date-only).
 */
export function formatDue(due: string, now: number, tz: string): DueInfo {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(due);
  const t = dateOnly ? NaN : Date.parse(due);
  if (!dateOnly && Number.isNaN(t)) return { label: due, overdue: false };
  let zone = tz;
  try {
    dayKey(now, zone);
  } catch {
    zone = 'UTC';
  }
  const today = dayKey(now, zone);
  const key = dateOnly ? due : dayKey(t, zone);
  const diff = dayNum(key) - dayNum(today);
  if (diff < 0) return { label: `Overdue ${-diff}d`, overdue: true };
  if (diff === 0) {
    if (dateOnly) return { label: 'Today', overdue: false };
    return t < now ? { label: `Overdue ${timeOf(t, zone)}`, overdue: true } : { label: `Today ${timeOf(t, zone)}`, overdue: false };
  }
  if (diff === 1) return { label: 'Tomorrow', overdue: false };
  return { label: weekdayDay(key), overdue: false };
}
