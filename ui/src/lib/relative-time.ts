import { useSyncExternalStore } from 'react';

const TICK_MS = 60_000;

export function formatRelative(iso: string, now: number): string {
  const t = Date.parse(iso);
  const diff = Number.isNaN(t) ? 0 : now - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let listening = false;
let now = Date.now();

function tick(): void {
  now = Date.now();
  for (const s of [...subs]) s();
}

function start(): void {
  if (timer === undefined && !document.hidden) timer = setInterval(tick, TICK_MS);
}

function stop(): void {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
}

function onVisibility(): void {
  if (document.hidden) {
    stop();
  } else {
    stop();
    start();
    tick();
  }
}

/** Shared 60 s ticker: one interval for all subscribers, paused while hidden, refreshed on visibility. */
export function subscribeTicker(cb: () => void): () => void {
  subs.add(cb);
  if (!listening) {
    document.addEventListener('visibilitychange', onVisibility);
    listening = true;
  }
  if (subs.size === 1) now = Date.now();
  start();
  return () => {
    subs.delete(cb);
    if (subs.size === 0) {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      listening = false;
    }
  };
}

/** Current ms timestamp, re-rendering the caller every tick. */
export function useNow(): number {
  return useSyncExternalStore(subscribeTicker, () => now);
}

/** Relative "updated ago" label for an ISO timestamp that ticks with the shared ticker. */
export function useRelative(iso: string): string {
  return formatRelative(iso, useNow());
}
