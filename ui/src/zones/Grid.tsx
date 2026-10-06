import { GridLayout, useContainerWidth, verticalCompactor } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { LayoutItem, ViewCard } from '../api/types.ts';
import { getExpandedVersion, isExpanded, subscribeExpanded } from '../frame/CardFrame.tsx';
import { DRAG_HANDLE, GRID_COLS, GRID_MARGIN, ROW_HEIGHT } from '../constants/grid.ts';
import { placeCards } from '../lib/placement.ts';
import { createLayoutWriter, type LayoutWriter } from './layout-writer.ts';
import './grid.css';

export interface GridProps {
  /** Cards in `zones.grid`, snapshot order. */
  cards: readonly ViewCard[];
  /** Full `snapshot.layout`, including entries of cards absent from the grid. */
  layout: readonly LayoutItem[];
  putLayout(layout: LayoutItem[]): Promise<void>;
  putLayoutKeepalive(layout: LayoutItem[]): void;
  renderCard(card: ViewCard): ReactNode;
}

function isChip(card: ViewCard): boolean {
  return card.collapsed && !isExpanded(card.id);
}

export function Grid(p: GridProps) {
  const { width, containerRef, mounted } = useContainerWidth();
  useSyncExternalStore(subscribeExpanded, getExpandedVersion);
  /** Local layout that wins over the snapshot while dragging or while a write is pending. */
  const [override, setOverride] = useState<LayoutItem[] | null>(null);
  const dragging = useRef(false);
  const latest = useRef(p);
  latest.current = p;

  const writerRef = useRef<LayoutWriter | null>(null);
  writerRef.current ??= createLayoutWriter(
    {
      put: (l) => latest.current.putLayout(l),
      putKeepalive: (l) => latest.current.putLayoutKeepalive(l),
    },
    () => {
      if (!dragging.current) setOverride(null);
    },
  );
  const writer = writerRef.current;

  useEffect(() => {
    const onHide = (): void => writer.flush();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      writer.cancel();
    };
  }, [writer]);

  const stored: readonly LayoutItem[] = override ?? p.layout;

  // Auto-place unplaced cards (D21) and persist.
  useEffect(() => {
    const placed = placeCards(stored, p.cards.map((c) => ({ id: c.id, size: c.size })));
    if (placed === stored) return;
    setOverride(placed);
    writer.schedule(placed);
  }, [stored, p.cards, writer]);

  const ids = useMemo(() => new Set(p.cards.map((c) => c.id)), [p.cards]);
  const chips = new Set(p.cards.filter(isChip).map((c) => c.id));

  const rendered: LayoutItem[] = stored
    .filter((l) => ids.has(l.i))
    .map((l) => (chips.has(l.i) ? { ...l, h: 1, minH: 1, isResizable: false } : l));

  const commit = useCallback(
    (next: readonly LayoutItem[]): void => {
      const current = override ?? latest.current.layout;
      const byId = new Map(next.map((n) => [n.i, n]));
      const chipIds = new Set(latest.current.cards.filter(isChip).map((c) => c.id));
      const merged = current.map((e) => {
        const n = byId.get(e.i);
        if (!n) return e; // absent card: untouched
        return { i: e.i, x: n.x, y: n.y, w: n.w, h: chipIds.has(e.i) ? e.h : n.h };
      });
      setOverride(merged);
      writer.schedule(merged);
    },
    [override, writer],
  );

  const stop = (next: readonly LayoutItem[]): void => {
    dragging.current = false;
    commit(next);
  };
  const start = (): void => {
    dragging.current = true;
    setOverride([...(override ?? latest.current.layout)]);
  };

  return (
    <div ref={containerRef} className="grid-zone" data-testid="grid-zone">
      {mounted && (
        <GridLayout
          width={width}
          layout={rendered}
          gridConfig={{ cols: GRID_COLS, rowHeight: ROW_HEIGHT, margin: GRID_MARGIN, containerPadding: [0, 0] }}
          dragConfig={{ enabled: true, handle: DRAG_HANDLE, cancel: 'button, a' }}
          resizeConfig={{ enabled: true, handles: ['se'] }}
          compactor={verticalCompactor}
          onDragStart={start}
          onResizeStart={start}
          onDragStop={(l) => stop(l)}
          onResizeStop={(l) => stop(l)}
        >
          {p.cards.map((c) => (
            <div key={c.id} className="grid-zone__item">
              {p.renderCard(c)}
            </div>
          ))}
        </GridLayout>
      )}
    </div>
  );
}
