import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ALERT_CAP } from '../../constants/types.ts';
import { CardLink } from '../../frame/CardLink.tsx';
import type { CardTypeProps } from '../../registry/registry.ts';
import type { KpiData, KpiMetric } from '../../../../src/index.js';
import { clampProps } from '../shared/clamp.ts';
import { ShowMore } from '../shared/ShowMore.tsx';
import { metrics, STATE_ICON, stateWord, trendView, valueText, type KpiState } from './logic.ts';
import './kpi.css';

const COMPACT_CAP = 4;

function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

function reducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function StateBadge({ state }: { state: unknown }) {
  const word = stateWord(state);
  if (!word) return null;
  return (
    <span role="img" className={`kpi-state kpi-state--${String(state)}`} aria-label={`State: ${word}`}>
      <span aria-hidden="true">{STATE_ICON[state as KpiState]}</span> <span className="kpi-state-word">{word}</span>
    </span>
  );
}

function Trend({ trend }: { trend: KpiMetric['trend'] }) {
  const t = trendView(trend);
  if (!t) return null;
  return (
    <span role="img" className={`kpi-trend kpi-trend--${t.tone}`} aria-label={t.label}>
      <span aria-hidden="true">{`${t.arrow} ${t.text}`}</span>
    </span>
  );
}

function Tile({ m, prev, reduced }: { m: KpiMetric; prev: KpiMetric | undefined; reduced: boolean }) {
  const text = valueText(m.value);
  const changed = prev !== undefined && (valueText(prev.value) !== text || prev.state !== m.state);
  const fade = changed && !reduced;
  const label = m.label ?? '';
  const body: ReactNode = (
    <>
      {label && <div {...clampProps(label, 1)} className="kpi-label clamp-1">{label}</div>}
      <div className="kpi-valrow">
        <span
          key={`${text}|${String(m.state)}`}
          data-fade={fade ? 'true' : undefined}
          title={text}
          className={`kpi-value${fade ? ' kpi-value--fade' : ''}${typeof m.value === 'string' ? ' clamp-2' : ''}`}
        >
          {text}
        </span>
        {m.unit && <span className="kpi-unit">{m.unit}</span>}
      </div>
      <div className="kpi-meta">
        <StateBadge state={m.state} />
        <Trend trend={m.trend} />
      </div>
    </>
  );
  return (
    <li className="kpi-tile">
      {m.link ? (
        <CardLink href={m.link} title={label || text}>
          <span className="kpi-tile-link">{body}</span>
        </CardLink>
      ) : (
        body
      )}
    </li>
  );
}

export function KpiBody({ card, data, mode }: CardTypeProps<KpiData>) {
  const items = metrics(data);
  const prevItems = usePrevious(items);
  const [reduced] = useState(reducedMotion);

  if (items.length === 0) return <p className="kpi-empty">–</p>;

  if (mode === 'alert') {
    const shown = items.slice(0, ALERT_CAP);
    const rest = items.length - shown.length;
    return (
      <div className="kpi-alert">
        {shown.map((m, i) => {
          const t = trendView(m.trend);
          const word = stateWord(m.state);
          return (
            <div key={i} className="kpi-alert-line">
              {word && <span role="img" className="kpi-alert-state" aria-label={`State: ${word}`}><span aria-hidden="true">{STATE_ICON[m.state as KpiState]}</span></span>}
              {m.label && <span className="kpi-alert-label">{m.label}</span>}
              <span className="kpi-alert-value">{`${valueText(m.value)}${m.unit ? ` ${m.unit}` : ''}`}</span>
              {t && <span role="img" className={`kpi-trend kpi-trend--${t.tone}`} aria-label={t.label}><span aria-hidden="true">{`${t.arrow} ${t.text}`}</span></span>}
            </div>
          );
        })}
        {rest > 0 && <span className="kpi-more">{`+${rest}`}</span>}
      </div>
    );
  }

  const full = mode === 'fullscreen';
  const shown = full ? items : items.slice(0, COMPACT_CAP);
  const rest = items.length - shown.length;
  const size = full ? 'full' : items.length === 1 ? 'single' : 'multi';
  return (
    <div className={`kpi-root kpi-root--${size}`}>
      <ul className="kpi-grid">
        {shown.map((m, i) => (
          <Tile key={i} m={m} prev={prevItems?.[i]} reduced={reduced} />
        ))}
      </ul>
      {rest > 0 && <ShowMore cardId={card.id} count={rest} />}
    </div>
  );
}
