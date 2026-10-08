import type { Snapshot, ViewCompletedAlert } from '../api/types.ts';
import { CardLink } from '../frame/CardLink.tsx';
import type { Filter } from '../lib/filter.ts';
import { useRelative } from '../lib/relative-time.ts';
import './completed.css';

export type CompletedRow =
  | { kind: 'card'; id: string; title: string; doneAt?: string }
  | { kind: 'alert'; id: string; item: ViewCompletedAlert };

/** `snap.completed` (server order) resolved against cards / completedAlertItems and scoped by the filter. */
export function resolveCompleted(snap: Snapshot, filter: Filter): CompletedRow[] {
  const rows: CompletedRow[] = [];
  for (const c of snap.completed) {
    if (c.kind === 'card') {
      const card = snap.cards[c.id];
      if (!card || filter === 'alerts') continue;
      rows.push({ kind: 'card', id: c.id, title: card.title, ...(card.doneAt ? { doneAt: card.doneAt } : {}) });
    } else {
      const item = snap.completedAlertItems[c.id];
      if (!item || filter === 'cards') continue;
      rows.push({ kind: 'alert', id: c.id, item });
    }
  }
  return rows;
}

export interface CompletedProps {
  rows: readonly CompletedRow[];
  open: boolean;
  onToggle(open: boolean): void;
  onReopen(cardId: string): void;
  /** Matching row keys (`<kind>:<id>`) while a search is active; null/undefined = no search. */
  matchKeys?: ReadonlySet<string> | null;
}

const Sep = () => (
  <span className="completed__sep" aria-hidden="true">
    {'·'}
  </span>
);

function Age({ prefix, iso }: { prefix: string; iso: string | undefined }) {
  const rel = useRelative(iso ?? '');
  if (!iso) return null;
  return (
    <>
      <Sep />
      <span className="completed__age">{`${prefix} ${rel}`}</span>
    </>
  );
}

export function Completed(p: CompletedProps) {
  if (p.rows.length === 0) return null;
  return (
    <section className="completed" aria-label="Completed" data-testid="completed">
      <button
        type="button"
        className="completed__head"
        aria-expanded={p.open}
        aria-controls="completed-list"
        onClick={() => p.onToggle(!p.open)}
      >
        <span>{`Completed (${p.rows.length})`}</span>
        <span className="completed__chevron" aria-hidden="true">{p.open ? '▾' : '▸'}</span>
      </button>
      {p.open ? (
        <ul className="completed__list" id="completed-list">
          {p.rows.map((r) => (
            <li
              key={`${r.kind}:${r.id}`}
              className={[
                'completed__row',
                p.matchKeys && (p.matchKeys.has(`${r.kind}:${r.id}`) ? 'card-frame--match' : 'card-frame--dim'),
              ]
                .filter(Boolean)
                .join(' ')}
              id={`completed-${r.kind}-${r.id}`}
              data-completed-id={r.id}
              data-completed-kind={r.kind}
            >
              <span className="completed__check" aria-hidden="true">✓</span>
              {r.kind === 'card' ? (
                <>
                  <strong className="completed__title" title={r.title}>{r.title}</strong>
                  <Age prefix="done" iso={r.doneAt} />
                  <button type="button" className="card-frame__btn completed__reopen" onClick={() => p.onReopen(r.id)}>
                    Reopen
                  </button>
                </>
              ) : (
                <>
                  <strong className="completed__title" title={r.item.title}>{r.item.title}</strong>
                  {r.item.text ? (
                    <>
                      <Sep />
                      <span className="completed__text" title={r.item.text}>{r.item.text}</span>
                    </>
                  ) : null}
                  {r.item.link ? (
                    <>
                      <Sep />
                      <span className="completed__link"><CardLink href={r.item.link}>link</CardLink></span>
                    </>
                  ) : null}
                  <Age prefix="ticked" iso={r.item.tickedAt} />
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
