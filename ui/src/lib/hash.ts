import { useSyncExternalStore } from 'react';

export interface CardHash {
  id: string;
  full: boolean;
}

/** Parses `#card=<id>[&view=full]`; null for anything else. */
export function parseCardHash(hash: string): CardHash | null {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const raw = p.get('card');
  if (!raw) return null;
  return { id: raw, full: p.get('view') === 'full' };
}

export function buildCardHash(id: string, full: boolean): string {
  return `#card=${encodeURIComponent(id)}${full ? '&view=full' : ''}`;
}

const INTERNAL = 'crontick-hash';

/** Rewrites the hash without adding history and notifies subscribers (replaceState fires no hashchange). */
export function replaceHash(hash: string): void {
  const url = location.pathname + location.search + hash;
  history.replaceState(null, '', url);
  window.dispatchEvent(new Event(INTERNAL));
}

function subscribe(l: () => void): () => void {
  window.addEventListener('hashchange', l);
  window.addEventListener(INTERNAL, l);
  return () => {
    window.removeEventListener('hashchange', l);
    window.removeEventListener(INTERNAL, l);
  };
}

export function useHash(): string {
  return useSyncExternalStore(subscribe, () => location.hash, () => '');
}
