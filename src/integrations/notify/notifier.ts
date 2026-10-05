/**
 * Notifier core (05 Task 4): turns 02 card events into OS toasts.
 *
 * Subscribes to `card:new` / `card:changed`; only cards with `notify:true` produce a toast.
 * 02 already guarantees non-Broken, in-window, changed-`updatedAt` and dedupes via `notified`,
 * so there is no dedupe here. All deliveries go through the single `dispatch()` seam:
 * Task 5 (burst control) wraps/replaces it, Task 6 (failure isolation + warnings) hardens it.
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

export const MAX_BODY = 140;

export interface NotifierOptions {
  events: Pick<CardEvents, 'on'>;
  adapter: NotifyAdapter;
  getPort: () => number;
  /** Boolean or a resolved gate result (Task 3). Function form is re-read per event. */
  gate: boolean | { enabled: boolean } | (() => boolean | { enabled: boolean });
  logger?: { warn(msg: string): void };
}

export interface Notifier {
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
  return s.length <= MAX_BODY ? s : `${s.slice(0, MAX_BODY - 1)}…`;
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
  const gateOn = (): boolean => {
    const g = typeof opts.gate === 'function' ? opts.gate() : opts.gate;
    return typeof g === 'boolean' ? g : g.enabled;
  };

  /** Single delivery seam: Task 5 adds burst control here, Task 6 adds failure isolation/warnings. */
  function dispatch(payload: NotifyPayload): void {
    try {
      void opts.adapter.notify(payload).catch((err: unknown) => {
        opts.logger?.warn(`notify failed: ${String(err)}`);
      });
    } catch (err) {
      opts.logger?.warn(`notify failed: ${String(err)}`);
    }
  }

  function handle({ card }: CardEventPayload): void {
    const e = envelope(card);
    if (e.notify !== true || !gateOn()) return;
    dispatch({
      title: e.title,
      body: summarize(card),
      openUrl: `http://127.0.0.1:${opts.getPort()}/#card=${encodeURIComponent(e.id)}`,
    });
  }

  const offs = [opts.events.on('card:new', handle), opts.events.on('card:changed', handle)];
  return { dispose: () => offs.forEach((off) => off()) };
}
