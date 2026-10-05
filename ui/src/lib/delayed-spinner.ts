import { useEffect, useState } from 'react';

export const SPINNER_DELAY_MS = 150;

/** True only once `active` has stayed true for `delayMs`; false immediately when it ends. */
export function useDelayedSpinner(active: boolean, delayMs: number = SPINNER_DELAY_MS): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(t);
  }, [active, delayMs]);
  return active && shown;
}
