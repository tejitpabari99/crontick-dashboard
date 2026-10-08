import { useSyncExternalStore } from 'react';
import type { Column, ViewCard } from '../api/types.ts';
import { CardFrame, getExpandedVersion, isExpanded, setExpanded, subscribeExpanded } from '../frame/CardFrame.tsx';
import { Chip } from '../frame/Chip.tsx';
import { NowZone } from './NowZone.tsx';
import './columns.css';

export interface ColumnsProps {
  columns: Record<Column, readonly ViewCard[]>;
  /** `snapshot.now` cards (rendered first in the center column). */
  now: readonly ViewCard[];
  query: string;
  /** Matching ids while a global search is active; null = no search. */
  matchIds: ReadonlySet<string> | null;
  nowPriorityThreshold: number;
  checked(id: string): ReadonlySet<string>;
  pending(id: string): ReadonlySet<string>;
  onItemAction(cardId: string, itemId: string, checked?: boolean): Promise<void>;
  onDone(id: string): void;
  onHide(id: string): void;
  onFullscreen(id: string): void;
}

/** DOM order is center, left, right (tab order matches the narrow layout); CSS areas place left | center | right. */
const DOM_ORDER: readonly Column[] = ['center', 'left', 'right'];

export function Columns(p: ColumnsProps) {
  useSyncExternalStore(subscribeExpanded, getExpandedVersion);
  const searching = p.matchIds !== null;
  return (
    <div className="columns" data-testid="columns">
      {DOM_ORDER.map((col) => {
        const cards = p.columns[col];
        const hasNow = col === 'center' && p.now.length > 0;
        return (
          <div
            key={col}
            className={['column', `column--${col}`, cards.length === 0 && !hasNow && 'column--empty'].filter(Boolean).join(' ')}
            data-column={col}
          >
            {col === 'center' ? (
              <NowZone
                panels={p.now}
                query={p.query}
                matchIds={p.matchIds}
                nowPriorityThreshold={p.nowPriorityThreshold}
                checked={p.checked}
                pending={p.pending}
                onItemAction={p.onItemAction}
                onDone={p.onDone}
                onHide={p.onHide}
                onFullscreen={p.onFullscreen}
              />
            ) : null}
            {cards.map((c) => {
              const dim = searching && !p.matchIds!.has(c.id);
              const match = Boolean(p.matchIds?.has(c.id));
              return c.collapsed && !isExpanded(c.id) ? (
                <Chip key={c.id} card={c} dim={dim} match={match} onExpand={(id) => setExpanded(id, true)} />
              ) : (
                <CardFrame
                  key={c.id}
                  card={c}
                  mode="column"
                  query={p.query}
                  dim={dim}
                  match={match}
                  checked={p.checked(c.id)}
                  pending={p.pending(c.id)}
                  nowPriorityThreshold={p.nowPriorityThreshold}
                  onItemAction={(itemId, checked) => p.onItemAction(c.id, itemId, checked)}
                  onDone={p.onDone}
                  onHide={p.onHide}
                  onFullscreen={p.onFullscreen}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
