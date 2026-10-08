/**
 * Shared API DTOs. TYPE-ONLY: nothing here may exist at runtime, so UI/CLI code
 * can `import type` from this file without pulling in server code.
 */
import type { BrokenReason } from '../constants/error-codes.js';

export type ViewReason = BrokenReason | 'error' | 'stale';
export type Column = 'left' | 'center' | 'right';

export interface ViewCard {
  id: string;
  type: string;
  title: string;
  /** Effective priority. */
  priority: number;
  notify: boolean;
  /** Absent for no-data cards. */
  updatedAt?: string;
  /** Always set; defaults resolved server-side. */
  column: Column;
  height: 'S' | 'M' | 'L' | 'auto';
  status: 'ok' | 'broken' | 'no-data';
  collapsed: boolean;
  done: boolean;
  /** Only while done. */
  doneAt?: string;
  /** Broken only. */
  reason?: ViewReason;
  /** Broken only. */
  message?: string;
  /** Present for ok cards; omitted for broken and no-data. */
  data?: Record<string, unknown>;
  /** Item ids ticked via `dismiss` (server-held state). */
  checked?: string[];
}

export interface ViewAlert {
  id: string;
  title: string;
  text?: string;
  link?: string;
  priority: number;
  updatedAt: string;
  status: 'ok' | 'broken';
  /** Broken only. */
  message?: string;
}

export interface ViewCompletedAlert {
  /** `.done` file stem; may carry a collision suffix. */
  id: string;
  title: string;
  text?: string;
  link?: string;
  priority: number;
  tickedAt: string;
}

export interface Snapshot {
  serverTime: string;
  rev: string;
  warnings: string[];
  config: { pollIntervalMs: number; nowPriorityThreshold: number };
  columns: Record<Column, string[]>;
  now: string[];
  alerts: string[];
  hidden: string[];
  /** Sorted by doneAt/tickedAt desc, then id. */
  completed: Array<{ kind: 'card' | 'alert'; id: string }>;
  /** Done cards stay here with done:true, doneAt. */
  cards: Record<string, ViewCard>;
  alertItems: Record<string, ViewAlert>;
  completedAlertItems: Record<string, ViewCompletedAlert>;
}
