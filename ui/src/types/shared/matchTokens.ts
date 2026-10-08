import { tokenize } from '../../lib/search.ts';

/** Case-insensitive, whitespace-token AND match — same semantics as global search. Empty query matches. */
export function matchTokens(text: string, query: string): boolean {
  const tokens = tokenize(query);
  if (tokens.length === 0) return true;
  const hay = text.toLowerCase();
  return tokens.every((t) => hay.includes(t));
}
