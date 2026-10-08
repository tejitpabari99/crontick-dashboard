import { describe, it, expect } from 'vitest';
import type {
  TableData, Cell, Column, ListData, ListItem, KpiData, KpiMetric,
  MarkdownData, MediaData, MediaItem, Show, CardDef, CardDefInput, Layout, DataFile, DataFileInput, Alert,
  BrokenReason, SkipReason, DefResult, FolderResult, AlertResult,
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
    const cd: Partial<CardDef> = {};
    const cdi: Partial<CardDefInput> = {};
    const ly: Partial<Layout> = {};
    const df: Partial<DataFile> = {};
    const dfi: Partial<DataFileInput> = {};
    const al: Partial<Alert> = {};
    const br: BrokenReason = 'unreadable';
    const sr: SkipReason = 'invalid-id';
    const dr: Partial<DefResult> = {};
    const fr: Partial<FolderResult> = {};
    const ar: Partial<AlertResult> = {};
    expect([cell, cols, t, l, li, k, km, m, md, mi, s, cd, cdi, ly, df, dfi, al, br, sr, dr, fr, ar]).toBeTruthy();
  });
});

describe('public runtime exports', () => {
  it('has the new validators and no envelope API', async () => {
    const api = await import('../../src/index.js');
    for (const k of ['parseCardDef', 'validateCardFolder', 'validateAlertFile', 'isCardFolderName', 'getExample', 'dataRequired', 'listTypes'])
      expect(api, k).toHaveProperty(k);
    for (const k of ['validateCardFile', 'getLegacyExample', 'getExampleFile', 'legacyAllowedKinds'])
      expect(api, k).not.toHaveProperty(k);
  });
});
