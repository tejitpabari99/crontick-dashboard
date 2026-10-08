import type { ViewAlert } from '../api/types.ts';
import { CardLink } from '../frame/CardLink.tsx';
import './alert-strip.css';

export interface AlertStripProps {
  /** `snapshot.alerts` resolved against `alertItems`, snapshot order. */
  alerts: readonly ViewAlert[];
  nowPriorityThreshold: number;
  onTick(id: string): void;
}

export function AlertStrip(p: AlertStripProps) {
  if (p.alerts.length === 0) return null;
  return (
    <section role="region" aria-live="polite" aria-label="Alerts" className="alert-strip">
      <ul className="alert-strip__list">
        {p.alerts.map((a) => (
          <li key={a.id} className="alert-strip__row" data-alert-id={a.id}>
            {a.priority >= p.nowPriorityThreshold ? (
              <span className="card-frame__priority" data-testid="priority-marker" aria-label="High priority" />
            ) : null}
            <strong className="alert-strip__title" title={a.title}>
              {a.title}
            </strong>
            <span className="alert-strip__body" title={a.status === 'broken' ? a.message : a.text}>
              {a.status === 'broken' ? `Broken alert file: ${a.message ?? ''}` : a.text}
              {a.status !== 'broken' && a.link ? <CardLink href={a.link}>{' ↗'}</CardLink> : null}
            </span>
            <button type="button" className="card-frame__btn alert-strip__tick" aria-label="Tick" onClick={() => p.onTick(a.id)}>
              ✓ Tick
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
