import type { ViewCard } from '../api/types.ts';
import { getCardType } from '../registry/registry.ts';

export interface SearchCard {
  id: string;
  title: string;
  status: 'ok' | 'broken';
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
