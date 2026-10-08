import { useCallback, useState } from 'react';
import { COMPLETED_OPEN_KEY } from '../constants/storage.ts';

export function readCompletedOpen(): boolean {
  try {
    return localStorage.getItem(COMPLETED_OPEN_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function writeCompletedOpen(open: boolean): void {
  try {
    localStorage.setItem(COMPLETED_OPEN_KEY, String(open));
  } catch {
    /* storage unavailable: state lasts for this session only */
  }
}

/** Completed section open state (default open, persisted). Lives in App so search/deep links can open it. */
export function useCompletedOpen(): [boolean, (open: boolean) => void] {
  const [open, set] = useState<boolean>(readCompletedOpen);
  const setOpen = useCallback((o: boolean) => {
    writeCompletedOpen(o);
    set(o);
  }, []);
  return [open, setOpen];
}
