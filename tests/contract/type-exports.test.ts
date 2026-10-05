import { describe, it, expect } from 'vitest';
import type {
  TableData, Cell, Column, ListData, ListItem, KpiData, KpiMetric,
  MarkdownData, MediaData, MediaItem, Show, Envelope, EnvelopeInput,
} from '../../src/index.js';

describe('per-type inferred types are exported', () => {
  it('compiles', () => {
    const cell: Cell = 'x';
    const cols: Column[] = ['a'];
    const t: Partial<TableData> = {};
    const l: Partial<ListData> = {};
    const li: Partial<ListItem> = {};
    const k: Partial<KpiData> = {};
    const km: Partial<KpiMetric> = {};
    const m: Partial<MarkdownData> = {};
    const md: Partial<MediaData> = {};
    const mi: Partial<MediaItem> = {};
    const s: Partial<Show> = {};
    const e: Partial<Envelope> = {};
    const ei: Partial<EnvelopeInput> = {};
    expect([cell, cols, t, l, li, k, km, m, md, mi, s, e, ei]).toBeTruthy();
  });
});
