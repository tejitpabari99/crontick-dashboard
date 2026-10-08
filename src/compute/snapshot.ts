/** Pure snapshot computation: cards + state + config + clock -> Snapshot. */
import { createHash } from 'node:crypto';
import type { DashboardConfig } from '../config.js';
import { parseDuration, windowActive } from '../contract/formats.js';
import { COMPLETED_ALERT_MAX, COMPLETED_ALERT_MAX_AGE_MS } from '../constants/feed.js';
import type { Layout } from '../contract/card-def.js';
import {
  envelope,
  type AlertEntry,
  type BrokenEntry,
  type CardEntry,
  type CardEnvelope,
  type CompletedAlertEntry,
  type NoDataEntry,
  type OkEntry,
} from '../feed/ingest.js';
import { sameInstant } from '../instant.js';
import type { Column, Snapshot, ViewAlert, ViewCard, ViewCompletedAlert, ViewReason } from '../shared/api-types.js';
import type { StateData } from '../state/store.js';

interface Show {
  cron: string;
  for?: string;
}

interface Item {
  view: ViewCard;
  hasCron: boolean;
  /** Sort key within a column. */
  order: number;
}

const DEFAULT_LAYOUT: Pick<Layout, 'column' | 'order' | 'height'> = { column: 'center', order: 0, height: 'auto' };
const slot = (l: Pick<Layout, 'column' | 'order' | 'height'> | undefined) => l ?? DEFAULT_LAYOUT;

export function inWindow(show: Show | undefined, now: Date, timezone: string): boolean {
  try {
    return windowActive(show, now, { timezone });
  } catch {
    return true;
  }
}

export function brokenReason(card: Pick<CardEnvelope, 'updatedAt' | 'error' | 'staleAfter'>, now: Date): { reason: ViewReason; message: string } | null {
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
  const c = envelope(e);
  if (!inWindow(c.show, now, tz)) return null;
  const l = slot(e.card.layout);
  const view: ViewCard = {
    id: c.id,
    type: c.type,
    title: c.title,
    priority: c.priority,
    notify: c.notify,
    updatedAt: c.updatedAt,
    column: l.column,
    height: l.height,
    collapsed: c.priority <= 1,
    done: false,
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
  return { view, hasCron: c.show?.cron !== undefined, order: l.order };
}

/** No data file yet: keeps its slot, no updatedAt/data, never Now/Done; `staleAfter` runs from card.json mtime. */
function noDataItem(e: NoDataEntry, now: Date, tz: string): Item | null {
  const c = e.card;
  if (!inWindow(c.show, now, tz)) return null;
  const l = slot(c.layout);
  const stale = brokenReason(
    { updatedAt: new Date(e.viewMtimeMs).toISOString(), ...(c.staleAfter !== undefined ? { staleAfter: c.staleAfter } : {}) },
    now,
  );
  const view: ViewCard = {
    id: c.id,
    type: c.type,
    title: c.title,
    priority: c.priority,
    notify: c.notify,
    column: l.column,
    height: l.height,
    collapsed: c.priority <= 1,
    done: false,
    status: 'no-data',
  };
  if (stale) {
    view.status = 'broken';
    view.reason = stale.reason;
    view.message = stale.message;
  }
  return { view, hasCron: false, order: l.order };
}

function brokenItem(e: BrokenEntry): Item {
  const l = slot(e.layout);
  return {
    view: {
      id: e.key,
      type: 'unknown',
      title: e.title,
      priority: 2,
      notify: false,
      updatedAt: new Date(e.mtimeMs).toISOString(),
      column: l.column,
      height: l.height,
      collapsed: false,
      done: false,
      status: 'broken',
      reason: e.reason,
      message: e.message,
    },
    hasCron: false,
    order: l.order,
  };
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const ms = (iso: string | undefined): number => {
  const t = iso === undefined ? NaN : Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

export function computeSnapshot(
  cards: Iterable<CardEntry>,
  alerts: Iterable<AlertEntry>,
  completedAlerts: Iterable<CompletedAlertEntry>,
  state: Readonly<StateData>,
  config: Pick<DashboardConfig, 'nowPriorityThreshold' | 'pollIntervalMs' | 'timezone'>,
  now: Date,
  warnings: readonly string[] = [],
): Snapshot {
  const items = new Map<string, Item>();
  for (const e of cards) {
    const it =
      e.status === 'ok' ? okItem(e, state, now, config.timezone) : e.status === 'no-data' ? noDataItem(e, now, config.timezone) : brokenItem(e);
    if (it) items.set(it.view.id, it);
  }

  const columns: Record<Column, string[]> = { left: [], center: [], right: [] };
  const nowIds: string[] = [];
  const hidden: string[] = [];
  const doneCards: string[] = [];
  for (const [id, { view, hasCron }] of items) {
    if (Object.hasOwn(state.hidden, id)) hidden.push(id);
    else if (view.updatedAt !== undefined && Object.hasOwn(state.acks, id) && sameInstant(state.acks[id]!, view.updatedAt)) {
      view.done = true;
      if (Object.hasOwn(state.doneAt, id)) view.doneAt = state.doneAt[id]!;
      doneCards.push(id);
    } else if (hasCron && view.priority >= config.nowPriorityThreshold) nowIds.push(id);
    else columns[view.column].push(id);
  }
  const v = (id: string): ViewCard => items.get(id)!.view;
  nowIds.sort(
    (a, b) => v(b).priority - v(a).priority || ms(v(b).updatedAt) - ms(v(a).updatedAt) || cmpStr(a, b),
  );
  for (const col of Object.keys(columns) as Column[]) {
    columns[col].sort((a, b) => items.get(a)!.order - items.get(b)!.order || cmpStr(a, b));
  }
  hidden.sort(cmpStr);

  const cardsOut: Record<string, ViewCard> = Object.create(null) as Record<string, ViewCard>;
  for (const id of [...items.keys()].sort()) cardsOut[id] = v(id);

  // Alerts (cards-only hide/done; alerts have their own window + tick).
  const alertItems: Record<string, ViewAlert> = Object.create(null) as Record<string, ViewAlert>;
  for (const a of alerts) {
    if (a.status === 'ok') {
      if (!inWindow(a.alert.show, now, config.timezone)) continue;
      alertItems[a.key] = {
        id: a.key,
        title: a.alert.title,
        ...(a.alert.text !== undefined ? { text: a.alert.text } : {}),
        ...(a.alert.link !== undefined ? { link: a.alert.link } : {}),
        priority: a.alert.priority,
        updatedAt: a.alert.updatedAt,
        status: 'ok',
      };
    } else {
      alertItems[a.key] = {
        id: a.key,
        title: a.title,
        priority: 2,
        updatedAt: new Date(a.mtimeMs).toISOString(),
        status: 'broken',
        message: a.message,
      };
    }
  }
  const alertIds = Object.keys(alertItems).sort(
    (a, b) =>
      alertItems[b]!.priority - alertItems[a]!.priority || ms(alertItems[b]!.updatedAt) - ms(alertItems[a]!.updatedAt) || cmpStr(a, b),
  );

  // Completed: ticked alerts (7 days, newest 50) + Done cards (uncapped).
  const minTick = now.getTime() - COMPLETED_ALERT_MAX_AGE_MS;
  const doneAlerts = [...completedAlerts]
    .filter((c) => c.mtimeMs >= minTick)
    .sort((a, b) => b.mtimeMs - a.mtimeMs || cmpStr(a.key, b.key))
    .slice(0, COMPLETED_ALERT_MAX);
  const completedAlertItems: Record<string, ViewCompletedAlert> = Object.create(null) as Record<string, ViewCompletedAlert>;
  const completedRows: Array<{ kind: 'card' | 'alert'; id: string; t: number }> = [];
  for (const c of doneAlerts) {
    completedAlertItems[c.key] = {
      id: c.key,
      title: c.title,
      ...(c.text !== undefined ? { text: c.text } : {}),
      ...(c.link !== undefined ? { link: c.link } : {}),
      priority: c.priority,
      tickedAt: c.tickedAt,
    };
    completedRows.push({ kind: 'alert', id: c.key, t: ms(c.tickedAt) });
  }
  for (const id of doneCards) completedRows.push({ kind: 'card', id, t: ms(v(id).doneAt) });
  completedRows.sort((a, b) => b.t - a.t || cmpStr(a.id, b.id) || cmpStr(a.kind, b.kind));

  const body = {
    warnings: [...warnings],
    config: { pollIntervalMs: config.pollIntervalMs, nowPriorityThreshold: config.nowPriorityThreshold },
    columns,
    now: nowIds,
    alerts: alertIds,
    hidden,
    completed: completedRows.map(({ kind, id }) => ({ kind, id })),
    cards: cardsOut,
    alertItems,
    completedAlertItems,
  };
  const rev = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
  return { serverTime: now.toISOString(), rev, ...body };
}
