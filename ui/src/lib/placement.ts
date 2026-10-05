import type { LayoutItem } from '../api/types.ts';

export const GRID_COLS = 12;
export type CardSize = 'S' | 'M' | 'L';
export const SIZE_DIMS: Record<CardSize, { w: number; h: number }> = {
  S: { w: 3, h: 4 },
  M: { w: 3, h: 7 },
  L: { w: 6, h: 9 },
};

export interface PlaceInput {
  id: string;
  size?: CardSize | undefined;
}

function overlaps(a: LayoutItem, b: LayoutItem): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Pure auto-placement (D21). Cards without a layout entry get the first free slot
 * (rows top→bottom, x left→right) in the given order. Existing entries (including
 * those of cards absent from `cards`) are returned untouched; only entries of
 * cards present in `cards` block placement. Returns `layout` itself if nothing is unplaced.
 */
export function placeCards(layout: readonly LayoutItem[], cards: readonly PlaceInput[]): LayoutItem[] {
  const placed = new Set(layout.map((l) => l.i));
  const present = new Set(cards.map((c) => c.id));
  const unplaced = cards.filter((c) => !placed.has(c.id));
  if (unplaced.length === 0) return layout as LayoutItem[];
  const out = [...layout];
  const occupied = layout.filter((l) => present.has(l.i));
  for (const c of unplaced) {
    const { w, h } = SIZE_DIMS[c.size ?? 'M'];
    const bottom = occupied.reduce((m, o) => Math.max(m, o.y + o.h), 0);
    let item: LayoutItem | undefined;
    for (let y = 0; y <= bottom && !item; y++) {
      for (let x = 0; x + w <= GRID_COLS; x++) {
        const cand = { i: c.id, x, y, w, h };
        if (!occupied.some((o) => overlaps(cand, o))) {
          item = cand;
          break;
        }
      }
    }
    item ??= { i: c.id, x: 0, y: bottom, w, h };
    out.push(item);
    occupied.push(item);
  }
  return out;
}
