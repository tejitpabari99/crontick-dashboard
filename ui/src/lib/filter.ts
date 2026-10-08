import { useCallback, useState } from 'react';
import { FILTER_KEY } from '../constants/storage.ts';

export type Filter = 'all' | 'alerts' | 'cards';
export const FILTERS: readonly Filter[] = ['all', 'alerts', 'cards'];

export function isFilter(v: unknown): v is Filter {
  return v === 'all' || v === 'alerts' || v === 'cards';
}

export function readFilter(): Filter {
  try {
    const v = localStorage.getItem(FILTER_KEY);
    return isFilter(v) ? v : 'all';
  } catch {
    return 'all';
  }
}

export function writeFilter(f: Filter): void {
  try {
    localStorage.setItem(FILTER_KEY, f);
  } catch {
    /* storage unavailable: filter lasts for this session only */
  }
}

/** Current header filter (persisted). Lives in App; pass the value down. */
export function useFilter(): [Filter, (f: Filter) => void] {
  const [filter, set] = useState<Filter>(readFilter);
  const setFilter = useCallback((f: Filter) => {
    writeFilter(f);
    set(f);
  }, []);
  return [filter, setFilter];
}
