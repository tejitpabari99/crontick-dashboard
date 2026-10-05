/**
 * Notifier core (05 Task 4): turns 02 card events into OS toasts.
 *
 * Subscribes to `card:new` / `card:changed`; only cards with `notify:true` produce a toast.
 * 02 already guarantees non-Broken, in-window, changed-`updatedAt` and dedupes via `notified`,
 * so there is no dedupe here. All deliveries go through the single `dispatch()` seam:
 * Task 5 (burst control) wraps/replaces it, Task 6 hardens deliver() (failure isolation + warnings).
 *
 * Body = one plain-text line (<=140 chars), never the card `data` beyond that line:
 *  markdown: first non-empty line, markdown syntax stripped
 *  list:     first item text, plus "(+N more)"
 *  kpi:      first metric as "<value><unit> <label>"
 *  table:    "N rows"
 *  media:    first caption, else "N images"
 */
import type { CardEvents, CardEventPayload } from '../../feed/events.js';
import type { Card } from '../../contract/validate.js';
import { envelope } from '../../feed/ingest.js';
import type { NotifyAdapter, NotifyPayload } from './adapter.js';
import { realClock, type Clock } from '../../clock.js';
import { DEFAULT_NOW_PRIORITY_THRESHOLD } from '../../constants/config.js';
import {
  NOTIFY_BURST_LIMIT,
  NOTIFY_BURST_WINDOW_MS,
  NOTIFY_MAX_BODY,
  NOTIFY_WARN_DELIVERY,
  NOTIFY_WARN_OFF,
} from '../../constants/notify.js';
import { loopbackUrl } from '../../utils/loopback.js';
import { realTimers, type TimeoutTimers } from '../../utils/timers.js';

export interface NotifierOptions {
  events: Pick<CardEvents, 'on'>;
  adapter: NotifyAdapter;
  getPort: () => number;
  /** Boolean or a resolved gate result (Task 3). Function form is re-read per event. */
  gate: GateValue | (() => GateValue);
  /** Optional warnings registry (02 `server.warnings`): off-state + delivery-failure warnings. */
  warnings?: { set(key: string, message: string): void; clear(key: string): void };
  logger?: { warn(msg: string): void };
  /** Burst-window time source (default real clock). */
  clock?: Clock;
  timers?: TimeoutTimers;
  /** Alerts with priority >= this are named in the summary, never collapsed away (default 3). */
  getThreshold?: () => number;
}

export type GateValue = boolean | { enabled: boolean; mode?: 'on' | 'off'; reason?: string; warning?: string };

export interface NotifierStatus {
  enabled: boolean;
  mode: 'on' | 'off';
  reason: string;
}

export interface Notifier {
  /** Current resolved gate (for 06 `info`). */
  status(): NotifierStatus;
  dispose(): void;
}

export function stripMarkdown(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)+/, '')
    .replace(/(\*\*|__|~~|[*_`])/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(s: string): string {
  return s.length <= NOTIFY_MAX_BODY ? s : `${s.slice(0, NOTIFY_MAX_BODY - 1)}…`;
}

const rec = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(rec) : []);
const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Plain-text one-line summary of a card's data (untruncated by type rules, then capped at 140). */
export function summarize(card: Card): string {
  const e = envelope(card);
  const d = rec(e.data);
  let out = '';
  switch (e.type) {
    case 'markdown': {
      for (const raw of str(d['text']).split(/\r?\n/)) {
        const s = stripMarkdown(raw);
        if (s !== '') {
          out = s;
          break;
        }
      }
      break;
    }
    case 'list': {
      const items = arr(d['items']);
      if (items.length > 0) {
        out = stripMarkdown(str(items[0]!['text']));
        if (items.length > 1) out += ` (+${items.length - 1} more)`;
      }
      break;
    }
    case 'kpi': {
      const m = arr(d['items'])[0];
      if (m) out = `${str(m['value'])}${str(m['unit'])} ${str(m['label'])}`.trim();
      break;
    }
    case 'table':
      out = plural(arr(d['rows']).length, 'row');
      break;
    case 'media': {
      const items = arr(d['items']);
      const cap = items.length > 0 ? stripMarkdown(str(items[0]!['caption'])) : '';
      out = cap !== '' ? cap : items.length > 0 ? plural(items.length, 'image') : '';
      break;
    }
  }
  return truncate(out);
}

export function createNotifier(opts: NotifierOptions): Notifier {
  const gateValue = (): GateValue => (typeof opts.gate === 'function' ? opts.gate() : opts.gate);
  const gateOn = (): boolean => {
    const g = gateValue();
    return typeof g === 'boolean' ? g : g.enabled;
  };
  const status = (): NotifierStatus => {
    const g = gateValue();
    const enabled = typeof g === 'boolean' ? g : g.enabled;
    const mode = typeof g === 'boolean' ? (enabled ? 'on' : 'off') : (g.mode ?? (enabled ? 'on' : 'off'));
    const reason = typeof g === 'boolean' ? 'set by caller' : (g.reason ?? 'unspecified');
    return { enabled, mode, reason };
  };
  const safe = (fn: () => void): void => {
    try {
      fn();
    } catch {
      /* isolation: never propagate */
    }
  };
  const logWarn = (msg: string): void => safe(() => opts.logger?.warn(msg));

  /** Keep the off-state warning in sync with the gate (set when off, cleared when on). */
  function syncGateWarning(): void {
    safe(() => {
      if (!opts.warnings) return;
      const g = gateValue();
      const st = status();
      if (st.enabled) {
        opts.warnings.clear(NOTIFY_WARN_OFF);
        return;
      }
      const extra = typeof g === 'object' && g.warning ? ` (${g.warning})` : '';
      opts.warnings.set(NOTIFY_WARN_OFF, `OS notifications are ${st.mode}: ${st.reason}${extra}`);
    });
  }

  const clock = opts.clock ?? realClock;
  const timers = opts.timers ?? realTimers;
  const threshold = (): number => opts.getThreshold?.() ?? DEFAULT_NOW_PRIORITY_THRESHOLD;

  /** Raw adapter call, fully isolated: sync throw, rejection or bad return are logged, never retried or propagated. */
  function deliver(payload: NotifyPayload): void {
    const fail = (err: unknown): void => {
      logWarn(`notify failed: ${String(err)}`);
      safe(() => opts.warnings?.set(NOTIFY_WARN_DELIVERY, 'OS notification delivery failed (see log); cleared on next success'));
    };
    const ok = (): void => safe(() => opts.warnings?.clear(NOTIFY_WARN_DELIVERY));
    try {
      const r: unknown = opts.adapter.notify(payload);
      if (r !== null && typeof r === 'object' && typeof (r as Promise<void>).then === 'function') {
        (r as Promise<void>).then(ok, fail);
      } else ok();
    } catch (err) {
      fail(err);
    }
  }

  // Burst window: opens at the first notification, closes NOTIFY_BURST_WINDOW_MS later.
  let windowEnd = 0;
  let fired = 0;
  let overflow = 0;
  let important: string[] = [];
  let timer: unknown;

  function flushSummary(): void {
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = undefined;
    const n = overflow;
    const names = important;
    windowEnd = 0;
    fired = 0;
    overflow = 0;
    important = [];
    if (n === 0) return;
    deliver({
      title: `${n} more update${n === 1 ? '' : 's'} on your dashboard`,
      body: names.length > 0 ? truncate(`High priority: ${names.join(', ')}`) : 'Open the dashboard to see them.',
      openUrl: loopbackUrl(opts.getPort(), '/'),
    });
  }

  /** Single delivery seam: burst control (Task 5) then deliver(). */
  function dispatch(payload: NotifyPayload, meta: { high: boolean }): void {
    const now = clock.now().getTime();
    if (windowEnd !== 0 && now >= windowEnd) flushSummary(); // window expired: close it, start fresh
    if (windowEnd === 0) windowEnd = now + NOTIFY_BURST_WINDOW_MS;
    if (fired < NOTIFY_BURST_LIMIT) {
      fired++;
      deliver(payload);
      return;
    }
    overflow++;
    if (meta.high) important.push(payload.title);
    timer ??= timers.setTimeout(flushSummary, Math.max(0, windowEnd - now));
  }

  function handle({ card }: CardEventPayload): void {
    try {
      handleInner(card);
    } catch (err) {
      logWarn(`notify failed: ${String(err)}`);
    }
  }

  function handleInner(card: Card): void {
    syncGateWarning();
    const e = envelope(card);
    if (e.notify !== true || !gateOn()) return;
    dispatch(
      {
        title: e.title,
        body: summarize(card),
        openUrl: loopbackUrl(opts.getPort(), `/#card=${encodeURIComponent(e.id)}`),
      },
      { high: e.kind === 'alert' && e.priority >= threshold() },
    );
  }

  syncGateWarning();
  const offs = [opts.events.on('card:new', handle), opts.events.on('card:changed', handle)];
  return {
    status,
    /** Unsubscribes, clears timers, and flushes any pending summary (nothing silently dropped). */
    dispose: () => {
      offs.forEach((off) => off());
      flushSummary();
    },
  };
}
