import { isUnseen } from '../lib/seen.ts';
import type { ViewCard } from '../api/types.ts';
import './chip.css';

export interface ChipProps {
  card: ViewCard;
  /** Match highlighting from global search (same classes as CardFrame). */
  dim?: boolean;
  match?: boolean;
  onExpand(id: string): void;
}

/** Collapsed chip: low-priority card in its own slot; click/Enter/Space expands. */
export function Chip({ card, dim, match, onExpand }: ChipProps) {
  const unseen = card.notify && card.updatedAt !== undefined && isUnseen({ id: card.id, updatedAt: card.updatedAt });
  const cls = ['chip', 'chip--collapsed', dim && 'card-frame--dim', match && 'card-frame--match'].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={cls}
      data-card-id={card.id}
      aria-expanded="false"
      aria-label={`Expand ${card.title}`}
      onClick={() => onExpand(card.id)}
    >
      <span className="chip__dot" aria-hidden="true" />
      <span className="chip__title" title={card.title}>
        {card.title}
      </span>
      {unseen ? <span className="card-frame__dot" data-testid="notify-dot" aria-label="New" /> : null}
      <span className="chip__chevron" aria-hidden="true">
        ▾
      </span>
    </button>
  );
}
