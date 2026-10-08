import type { Snapshot } from '../api/types.ts';
import { isUnseen } from './seen.ts';

/** Alerts + unseen `notify` cards among now ∪ columns (the `(n)` in `document.title`). No-data and Done cards excluded. */
export function attentionCount(snap: Snapshot): number {
  const ids = new Set([...snap.now, ...snap.columns.left, ...snap.columns.center, ...snap.columns.right]);
  let n = snap.alerts.length;
  for (const id of ids) {
    const c = snap.cards[id];
    if (c && c.notify && c.status !== 'no-data' && c.updatedAt !== undefined && isUnseen({ id, updatedAt: c.updatedAt })) n++;
  }
  return n;
}
