import type { ViewAlert, ViewCard } from '../api/types.ts';
import { getCardType } from '../registry/registry.ts';

export interface SearchCard {
  id: string;
  title: string;
  status: ViewCard['status'];
  message?: string | undefined;
  /** Per-card searchable text supplied by the type registry. */
  searchText?: string | undefined;
}

export function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Ids of cards matching every token (case-insensitive). Empty query → []. Broken = title + message only. */
export function matchCards(cards: readonly SearchCard[], query: string): string[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  return cards
    .filter((c) => {
      const hay = (c.status === 'broken' ? `${c.title} ${c.message ?? ''}` : `${c.title} ${c.searchText ?? ''}`).toLowerCase();
      return tokens.every((t) => hay.includes(t));
    })
    .map((c) => c.id);
}

/** Adapt a snapshot card for `matchCards` using its registry `searchText` (errors → title only). */
export function toSearchCard(card: ViewCard): SearchCard {
  let searchText: string | undefined;
  if (card.status !== 'broken') {
    try {
      searchText = getCardType(card.type)?.searchText(card.data ?? {});
    } catch {
      searchText = undefined;
    }
  }
  return { id: card.id, title: card.title, status: card.status, message: card.message, searchText };
}

/** Alert rows match by title + text (broken alerts: title + message). */
export function toSearchAlert(a: ViewAlert): SearchCard {
  return { id: a.id, title: a.title, status: 'ok', searchText: a.status === 'broken' ? a.message : a.text };
}

/** Where a search match lives; used to focus/scroll to it (Enter cycling). */
export interface SearchTarget {
  zone: 'card' | 'alert' | 'completed';
  id: string;
  /** Completed rows only. */
  completedKind?: 'card' | 'alert';
}

export function targetSelector(t: SearchTarget): string {
  const id = CSS.escape(t.id);
  if (t.zone === 'alert') return `[data-alert-id="${id}"]`;
  if (t.zone === 'completed') return `[data-completed-kind="${t.completedKind}"][data-completed-id="${id}"]`;
  return `[data-card-id="${id}"]`;
}
