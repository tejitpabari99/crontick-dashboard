import type { KpiData, KpiMetric } from '../../../../src/index.js';
import { formatNumber } from '../shared/format.ts';

export type KpiState = NonNullable<KpiMetric['state']>;

export const STATE_WORD: Record<KpiState, string> = { ok: 'OK', pending: 'Pending', fail: 'Failed', warn: 'Warning' };
export const STATE_ICON: Record<KpiState, string> = { ok: '✅', pending: '⏳', fail: '❌', warn: '⚠' };

export function metrics(data: KpiData | undefined): KpiMetric[] {
  return Array.isArray(data?.items) ? data.items : [];
}

/** Display text for a value: number via Intl.NumberFormat, string verbatim, missing -> "–". */
export function valueText(v: unknown): string {
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'string' && v !== '') return v;
  return '–';
}

export function stateWord(s: unknown): string {
  return typeof s === 'string' && s in STATE_WORD ? STATE_WORD[s as KpiState] : '';
}

export interface TrendView {
  arrow: '▲' | '▼' | '–';
  text: string;
  tone: 'positive' | 'negative' | 'flat';
  label: string;
}

export function trendView(t: KpiMetric['trend']): TrendView | null {
  if (!t || typeof t.delta !== 'number' || !Number.isFinite(t.delta)) return null;
  const dir = t.dir ?? (t.delta > 0 ? 'up' : t.delta < 0 ? 'down' : 'flat');
  const good = t.good ?? 'up';
  const tone = dir === 'flat' ? 'flat' : dir === good ? 'positive' : 'negative';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–';
  const sign = t.delta > 0 ? '+' : '';
  const text = `${sign}${formatNumber(t.delta)}`;
  const word = dir === 'flat' ? 'unchanged' : dir === 'up' ? 'up' : 'down';
  return { arrow, text, tone, label: `Trend ${word} ${text}, ${tone === 'positive' ? 'good' : tone === 'negative' ? 'bad' : 'neutral'}` };
}

export function kpiSearchText(data: KpiData): string {
  return metrics(data)
    .map((m) => [m.label, m.value, m.unit, stateWord(m.state)].filter((x) => x !== undefined && x !== '').join(' '))
    .join(' ');
}
