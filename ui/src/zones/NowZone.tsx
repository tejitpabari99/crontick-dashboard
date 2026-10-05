import type { ViewCard } from '../api/types.ts';
import { CardFrame } from '../frame/CardFrame.tsx';
import { AlertStrip } from './AlertStrip.tsx';
import './now-zone.css';

export interface NowZoneProps {
  alerts: readonly ViewCard[];
  /** `zones.now` cards, snapshot order. */
  panels: readonly ViewCard[];
  query: string;
  nowPriorityThreshold: number;
  checked(id: string): ReadonlySet<string>;
  pending(id: string): ReadonlySet<string>;
  onItemAction(cardId: string, itemId: string): Promise<void>;
  onTick(id: string): void;
  onDone(id: string): void;
  onHide(id: string): void;
  onFullscreen(id: string): void;
}

export function NowZone(p: NowZoneProps) {
  if (p.alerts.length === 0 && p.panels.length === 0) return null;
  return (
    <section className="now-zone" aria-label="Now" data-testid="now-zone">
      <AlertStrip
        cards={p.alerts}
        query={p.query}
        nowPriorityThreshold={p.nowPriorityThreshold}
        checked={p.checked}
        pending={p.pending}
        onItemAction={p.onItemAction}
        onTick={p.onTick}
      />
      {p.panels.length > 0 ? (
        <div className="now-zone__panels">
          {p.panels.map((c) => (
            <div key={c.id} className="now-zone__panel">
              <CardFrame
                card={c}
                mode="now"
                query={p.query}
                checked={p.checked(c.id)}
                pending={p.pending(c.id)}
                nowPriorityThreshold={p.nowPriorityThreshold}
                onItemAction={(itemId) => p.onItemAction(c.id, itemId)}
                onDone={p.onDone}
                onHide={p.onHide}
                onFullscreen={p.onFullscreen}
              />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
