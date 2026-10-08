import { POLL_DEFAULT_MS } from '../../../src/constants/poll.ts';
import type { Snapshot, ViewAlert, ViewCard, ViewCompletedAlert } from '../../src/api/types.ts';

export function vcard(id: string, type: string, over: Partial<ViewCard> = {}): ViewCard {
  return {
    id,
    type,
    title: `T-${id}`,
    priority: 3,
    notify: false,
    updatedAt: '2026-10-05T10:00:00Z',
    column: 'center',
    height: 'M',
    status: 'ok',
    collapsed: false,
    done: false,
    data: {},
    ...over,
  };
}

export interface Placement {
  left?: string[];
  center?: string[];
  right?: string[];
  now?: string[];
  alerts?: string[];
  hidden?: string[];
  completed?: Snapshot['completed'];
}

export function valert(id: string, over: Partial<ViewAlert> = {}): ViewAlert {
  return { id, title: `A-${id}`, priority: 3, updatedAt: '2026-10-05T10:00:00Z', status: 'ok', ...over };
}

export function snapshotOf(
  cards: ViewCard[],
  p: Placement = {},
  extra: { alertItems?: ViewAlert[]; completedAlertItems?: ViewCompletedAlert[] } = {},
): Snapshot {
  return {
    serverTime: 't',
    rev: 'r',
    warnings: [],
    config: { pollIntervalMs: POLL_DEFAULT_MS, nowPriorityThreshold: 5 },
    columns: { left: p.left ?? [], center: p.center ?? [], right: p.right ?? [] },
    now: p.now ?? [],
    alerts: p.alerts ?? [],
    hidden: p.hidden ?? [],
    completed: p.completed ?? [],
    cards: Object.fromEntries(cards.map((c) => [c.id, c])),
    alertItems: Object.fromEntries((extra.alertItems ?? []).map((a) => [a.id, a])),
    completedAlertItems: Object.fromEntries((extra.completedAlertItems ?? []).map((a) => [a.id, a])),
  };
}
