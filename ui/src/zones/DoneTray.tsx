import type { ViewCard } from '../api/types.ts';
import { useRelative } from '../lib/relative-time.ts';
import './now-zone.css';

export interface DoneTrayProps {
  /** `zones.tray` cards, snapshot order. */
  cards: readonly ViewCard[];
  onReopen(id: string): void;
}

function Chip({ card, onReopen }: { card: ViewCard; onReopen(id: string): void }) {
  const age = useRelative(card.updatedAt);
  return (
    <button type="button" className="done-tray__chip" data-card-id={card.id} onClick={() => onReopen(card.id)}>
      <span className="done-tray__name">{card.title}</span>
      <span className="done-tray__age">{age}</span>
    </button>
  );
}

export function DoneTray(p: DoneTrayProps) {
  if (p.cards.length === 0) return null;
  return (
    <section className="done-tray" aria-labelledby="done-tray-h" data-testid="done-tray">
      <h2 id="done-tray-h" className="done-tray__title">
        Done ({p.cards.length})
      </h2>
      <div className="done-tray__chips">
        {p.cards.map((c) => (
          <Chip key={c.id} card={c} onReopen={p.onReopen} />
        ))}
      </div>
    </section>
  );
}
