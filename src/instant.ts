/**
 * The one "same instant" comparison used everywhere (snapshot, events, write-back, actions, registry).
 * Semantics: both values are strings and either byte-identical, or both parse as dates to the same epoch ms
 * (so `...Z` and `...+00:00` forms of one moment match). Anything else (non-string, unparseable and
 * not identical) is false.
 */
export function sameInstant(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a === b) return true;
  const x = Date.parse(a);
  return !Number.isNaN(x) && x === Date.parse(b);
}
