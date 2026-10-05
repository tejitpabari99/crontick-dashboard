/** Pure snapshot computation: cards + state + config + clock -> Snapshot. */
import { createHash } from 'node:crypto';
import type { DashboardConfig } from '../config.js';
import { parseDuration, windowActive } from '../contract/formats.js';
import type { CardEntry, OkEntry } from '../feed/ingest.js';
import type { LayoutItem, Snapshot, ViewCard, ViewReason, Zones } from '../shared/api-types.js';
import type { StateData } from '../state/store.js';

interface Show {
  cron: string;
  for?: string;
}

/** Narrow, typed view of the envelope fields compute needs (Card fields surface as unknown). */
interface Env {
  id: string;
  kind: 'panel' | 'alert';
  type: string;
  title: string;
  updatedAt: string;
  priority: number;
  notify: boolean;
  size?: 'S' | 'M' | 'L';
  show?: Show;
  staleAfter?: string;
  error: string | null;
  data?: Record<string, unknown>;
}
const env = (card: OkEntry['card']): Env => card as unknown as Env;

interface Item {
  view: ViewCard;
  hasCron: boolean;
  windowOn: boolean;
}

const sameInstant = (a: string, b: string): boolean => {
  const x = Date.parse(a);
  const y = Date.parse(b);
  return a === b || (!Number.isNaN(x) && x === y);
};

export function inWindow(show: Show | undefined, now: Date, timezone: string): boolean {
  try {
    return windowActive(show, now, { timezone });
  } catch {
    return true;
  }
}

export function brokenReason(card: Env, now: Date): { reason: ViewReason; message: string } | null {
  if (card.error !== null && card.error !== undefined && card.error !== '') return { reason: 'error', message: card.error };
  if (card.staleAfter !== undefined) {
    try {
      const age = now.getTime() - Date.parse(card.updatedAt);
      if (age > parseDuration(card.staleAfter)) {
        return { reason: 'stale', message: `no update for more than ${card.staleAfter}` };
      }
    } catch {
      // invalid duration cannot pass validation; treat as not stale
    }
  }
  return null;
}

function okItem(e: OkEntry, st: Readonly<StateData>, now: Date, tz: string): Item | null {
  const c = env(e.card);
  const show = c.show;
  if (!inWindow(show, now, tz)) return null;
  const view: ViewCard = {
    id: c.id,
    kind: c.kind,
    type: c.type,
    title: c.title,
    priority: c.priority,
    ...(c.size !== undefined ? { size: c.size } : {}),
    notify: c.notify,
    updatedAt: c.updatedAt,
    collapsed: c.kind === 'panel' && c.priority <= 1,
    status: 'ok',
  };
  const b = brokenReason(c, now);
  if (b) {
    view.status = 'broken';
    view.reason = b.reason;
    view.message = b.message;
  } else if (c.data !== undefined) {
    view.data = c.data;
  }
  const chk = Object.hasOwn(st.checks, c.id) ? st.checks[c.id] : undefined;
  if (chk && sameInstant(chk.updatedAt, c.updatedAt)) view.checked = [...chk.items];
  return { view, hasCron: show?.cron !== undefined, windowOn: true };
}

function brokenItem(e: Exclude<CardEntry, OkEntry>): Item {
  const id = e.key;
  return {
    view: {
      id,
      kind: 'panel',
      type: 'unknown',
      title: e.title,
      priority: 2,
      notify: false,
      updatedAt: new Date(e.mtimeMs).toISOString(),
      collapsed: false,
      status: 'broken',
      reason: e.reason,
      message: e.message,
    },
    hasCron: false,
    windowOn: true,
  };
}

const byOrder = (items: Map<string, Item>) => (a: string, b: string): number => {
  const x = items.get(a)!.view;
  const y = items.get(b)!.view;
  if (x.priority !== y.priority) return y.priority - x.priority;
  const tx = Date.parse(x.updatedAt);
  const ty = Date.parse(y.updatedAt);
  if (tx !== ty) return (Number.isNaN(ty) ? 0 : ty) - (Number.isNaN(tx) ? 0 : tx);
  return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
};

export function computeSnapshot(
  cards: Iterable<CardEntry>,
  state: Readonly<StateData>,
  config: Pick<DashboardConfig, 'nowPriorityThreshold' | 'pollIntervalMs' | 'timezone'>,
  now: Date,
  warnings: readonly string[] = [],
): Snapshot {
  const items = new Map<string, Item>();
  for (const e of cards) {
    const it = e.status === 'ok' ? okItem(e, state, now, config.timezone) : brokenItem(e);
    if (it) items.set(it.view.id, it);
  }

  const zones: Zones = { alerts: [], now: [], grid: [], tray: [], hidden: [] };
  for (const [id, { view, hasCron }] of items) {
    if (Object.hasOwn(state.hidden, id)) zones.hidden.push(id);
    else if (view.kind === 'alert') zones.alerts.push(id);
    else if (Object.hasOwn(state.acks, id) && sameInstant(state.acks[id]!, view.updatedAt)) zones.tray.push(id);
    else if (hasCron && view.priority >= config.nowPriorityThreshold) zones.now.push(id);
    else zones.grid.push(id);
  }
  const cmp = byOrder(items);
  for (const z of Object.keys(zones) as (keyof Zones)[]) zones[z].sort(cmp);

  const out: Record<string, ViewCard> = Object.create(null) as Record<string, ViewCard>;
  for (const id of [...items.keys()].sort()) out[id] = items.get(id)!.view;

  const body = {
    warnings: [...warnings],
    config: { pollIntervalMs: config.pollIntervalMs, nowPriorityThreshold: config.nowPriorityThreshold },
    zones,
    cards: out,
    layout: state.layout as LayoutItem[],
  };
  const rev = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
  return { serverTime: now.toISOString(), rev, ...body };
}
