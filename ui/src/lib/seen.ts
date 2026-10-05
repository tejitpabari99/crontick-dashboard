export const SEEN_KEY = 'crontick-dashboard.seen';

let version = 0;
const listeners = new Set<() => void>();

/** useSyncExternalStore pair: `getVersion` bumps whenever `markSeen` runs. */
export function subscribeSeen(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export const getSeenVersion = (): number => version;

type SeenMap = Record<string, string>;

function read(): SeenMap {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return {};
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as SeenMap) : {};
  } catch {
    return {};
  }
}

export function isUnseen(card: { id: string; updatedAt: string }): boolean {
  return read()[card.id] !== card.updatedAt;
}

export function markSeen(card: { id: string; updatedAt: string }): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ ...read(), [card.id]: card.updatedAt }));
  } catch {
    /* storage unavailable: in-page highlight only */
  }
  version += 1;
  for (const l of [...listeners]) l();
}
