import type { ViewCard } from '../api/types.ts';
import { CardFrame } from '../frame/CardFrame.tsx';
import './now-zone.css';

export interface NowZoneProps {
  /** `snapshot.now` cards, snapshot order. */
  panels: readonly ViewCard[];
  query: string;
  /** Matching ids while a global search is active; null/undefined = no search. */
  matchIds?: ReadonlySet<string> | null;
  nowPriorityThreshold: number;
  checked(id: string): ReadonlySet<string>;
  pending(id: string): ReadonlySet<string>;
  onItemAction(cardId: string, itemId: string, checked?: boolean): Promise<void>;
  onDone(id: string): void;
  onHide(id: string): void;
  onFullscreen(id: string): void;
}

export function NowZone(p: NowZoneProps) {
  if (p.panels.length === 0) return null;
  return (
    <section className="now-zone" aria-labelledby="now-zone-h" data-testid="now-zone">
      <h2 id="now-zone-h" className="sr-only">
        Now
      </h2>
      {p.panels.map((c) => (
        <div key={c.id} className="now-zone__panel">
          <CardFrame
            card={c}
            mode="now"
            query={p.query}
            dim={Boolean(p.matchIds) && !p.matchIds!.has(c.id)}
            match={Boolean(p.matchIds?.has(c.id))}
            checked={p.checked(c.id)}
            pending={p.pending(c.id)}
            nowPriorityThreshold={p.nowPriorityThreshold}
            onItemAction={(itemId, checked) => p.onItemAction(c.id, itemId, checked)}
            onDone={p.onDone}
            onHide={p.onHide}
            onFullscreen={p.onFullscreen}
          />
        </div>
      ))}
    </section>
  );
}
