import type { ViewAlert } from '../api/types.ts';
import { CardLink } from '../frame/CardLink.tsx';
import { clampProps } from '../types/shared/clamp.ts';
import './alert-strip.css';

export interface AlertStripProps {
  /** `snapshot.alerts` resolved against `alertItems`, snapshot order. */
  alerts: readonly ViewAlert[];
  nowPriorityThreshold: number;
  onTick(id: string): void;
}

const Sep = () => (
  <span className="alert-strip__sep" aria-hidden="true">
    {'·'}
  </span>
);

/** One single-line row per alert: dot, title, text?, link?, tick. Never side-by-side. */
export function AlertStrip(p: AlertStripProps) {
  if (p.alerts.length === 0) return null;
  return (
    <section role="region" aria-live="polite" aria-label="Alerts" className="alert-strip">
      <ul className="alert-strip__list">
        {p.alerts.map((a) => {
          const broken = a.status === 'broken';
          const high = a.priority >= p.nowPriorityThreshold;
          const body = broken ? `Broken alert file: ${a.message ?? ''}` : a.text;
          const link = broken ? undefined : a.link;
          return (
            <li
              key={a.id}
              className={broken ? 'alert-strip__row alert-strip__row--broken' : 'alert-strip__row'}
              data-alert-id={a.id}
            >
              <span
                className={high ? 'alert-strip__dot alert-strip__dot--high' : 'alert-strip__dot'}
                data-testid="priority-marker"
                title={`Priority ${a.priority}`}
                aria-label={high ? 'High priority' : `Priority ${a.priority}`}
              />
              <strong className="alert-strip__title" title={a.title}>
                {a.title}
              </strong>
              {body ? (
                <>
                  <Sep />
                  <span {...clampProps(body, 1)} className="clamp-1 alert-strip__body">
                    {body}
                  </span>
                </>
              ) : null}
              {link ? (
                <>
                  <Sep />
                  <span className="alert-strip__link">
                    <CardLink href={link}>link</CardLink>
                  </span>
                </>
              ) : null}
              <button type="button" className="card-frame__btn alert-strip__tick" onClick={() => p.onTick(a.id)}>
                ✓ Tick
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
