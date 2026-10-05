import { useCallback, useMemo, useState } from 'react';
import { matchTokens } from './matchTokens.ts';

export interface QueryFilter<T> {
  visible: T[];
  /** Rows removed by the query (0 when not filtering or overridden). */
  hidden: number;
  /** Query active, nothing matches, and the user has not chosen "Show all". */
  zeroMatch: boolean;
  /** Local override until the query changes. */
  showAll: () => void;
}

/** Pre-filters by the global query with a local "Show all" override that resets when the query changes. */
export function useQueryFilter<T>(items: readonly T[], query: string, getText: (item: T) => string): QueryFilter<T> {
  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  const overridden = overrideFor === query;
  const matched = useMemo(() => items.filter((it) => matchTokens(getText(it), query)), [items, query, getText]);
  const showAll = useCallback(() => setOverrideFor(query), [query]);
  if (overridden || matched.length === items.length) {
    return { visible: [...items], hidden: 0, zeroMatch: false, showAll };
  }
  return { visible: matched, hidden: items.length - matched.length, zeroMatch: matched.length === 0, showAll };
}
