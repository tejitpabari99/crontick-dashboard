/**
 * Shared API DTOs. TYPE-ONLY: nothing here may exist at runtime, so UI/CLI code
 * can `import type` from this file without pulling in server code.
 */
import type { BrokenReason } from '../constants/error-codes.js';

export type ViewReason = BrokenReason | 'error' | 'stale' | 'duplicate-id' | 'no-data';

export interface ViewCard {
  id: string;
  kind: 'panel' | 'alert';
  type: string;
  title: string;
  priority: number;
  size?: 'S' | 'M' | 'L';
  notify: boolean;
  updatedAt: string;
  collapsed: boolean;
  status: 'ok' | 'broken';
  /** Broken only. */
  reason?: ViewReason;
  /** Broken only. */
  message?: string;
  /** Present for ok cards in every zone; omitted for broken. */
  data?: Record<string, unknown>;
  /** Item ids ticked via `dismiss` (server-held state). */
  checked?: string[];
}

export interface Zones {
  alerts: string[];
  now: string[];
  grid: string[];
  tray: string[];
  hidden: string[];
}

export interface Snapshot {
  serverTime: string;
  rev: string;
  warnings: string[];
  config: { pollIntervalMs: number; nowPriorityThreshold: number };
  zones: Zones;
  cards: Record<string, ViewCard>;
}
