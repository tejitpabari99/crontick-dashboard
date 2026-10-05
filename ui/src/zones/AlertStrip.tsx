import type { ViewCard } from '../api/types.ts';
import { getCardType } from '../registry/registry.ts';
import { UnknownBody } from '../registry/unknown.tsx';
import { ErrorBoundary } from '../frame/ErrorBoundary.tsx';
import { BrokenBody } from '../frame/BrokenBody.tsx';

export interface AlertStripProps {
  /** `zones.alerts` cards, snapshot order. */
  cards: readonly ViewCard[];
  query: string;
  nowPriorityThreshold: number;
  checked(id: string): ReadonlySet<string>;
  pending(id: string): ReadonlySet<string>;
  onItemAction(cardId: string, itemId: string): Promise<void>;
  onTick(id: string): void;
}

export function AlertStrip(p: AlertStripProps) {
  if (p.cards.length === 0) return null;
  return (
    <section role="region" aria-live="polite" aria-label="Alerts" className="alert-strip">
      <ul className="alert-strip__list">
        {p.cards.map((c) => {
          const Body = c.status === 'broken' ? undefined : getCardType(c.type)?.Component;
          return (
            <li key={c.id} className="alert-strip__row" data-card-id={c.id}>
              {c.priority >= p.nowPriorityThreshold ? (
                <span className="card-frame__priority" data-testid="priority-marker" aria-label="High priority" />
              ) : null}
              <strong className="alert-strip__title" title={c.title}>
                {c.title}
              </strong>
              <div className="alert-strip__body">
                <ErrorBoundary>
                  {c.status === 'broken' ? (
                    <BrokenBody card={c} />
                  ) : Body ? (
                    <Body
                      card={c}
                      data={c.data}
                      mode="alert"
                      query={p.query}
                      checked={p.checked(c.id)}
                      pending={p.pending(c.id)}
                      onItemAction={(itemId) => p.onItemAction(c.id, itemId)}
                    />
                  ) : (
                    <UnknownBody type={c.type} />
                  )}
                </ErrorBoundary>
              </div>
              <button type="button" className="card-frame__btn alert-strip__tick" aria-label="Tick" onClick={() => p.onTick(c.id)}>
                ✓ Tick
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
