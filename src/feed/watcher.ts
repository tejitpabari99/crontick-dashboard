/** fs.watch wiring for the feed ingest: recursive watch on feed/, 200 ms per-folder debounce, periodic rescan. */
import { watch, mkdirSync, type FSWatcher } from 'node:fs';
import { FEED_DEBOUNCE_MS, FEED_RESCAN_MS } from '../constants/feed.js';
import { realTimers, type TimeoutTimers } from '../utils/timers.js';
import { createFeedIngest, type FeedIngest, type FeedIngestOptions } from './ingest.js';

export interface FeedWatcherOptions extends FeedIngestOptions {
  debounceMs?: number;
  rescanMs?: number;
}

export interface FeedWatcher extends FeedIngest {
  /** Startup scan + begin watching. */
  start(): void;
  stop(): void;
}

export function createFeedWatcher(opts: FeedWatcherOptions): FeedWatcher {
  const timers: TimeoutTimers = opts.timers ?? realTimers;
  const ingest = createFeedIngest({ ...opts, timers });
  const debounce = opts.debounceMs ?? FEED_DEBOUNCE_MS;
  const pending = new Map<string, unknown>();
  let watcher: FSWatcher | undefined;
  let rescanTimer: unknown;
  let running = false;

  function schedule(name: string): void {
    const old = pending.get(name);
    if (old !== undefined) timers.clearTimeout(old);
    pending.set(
      name,
      timers.setTimeout(() => {
        pending.delete(name);
        ingest.processFolder(name);
      }, debounce),
    );
  }

  function tickRescan(): void {
    if (!running) return;
    ingest.rescan();
    rescanTimer = timers.setTimeout(tickRescan, opts.rescanMs ?? FEED_RESCAN_MS);
    (rescanTimer as { unref?: () => void } | undefined)?.unref?.();
  }

  return {
    ...ingest,
    start() {
      if (running) return;
      running = true;
      mkdirSync(opts.feedDir, { recursive: true });
      ingest.rescan();
      try {
        watcher = watch(opts.feedDir, { persistent: false, recursive: true }, (_ev, filename) => {
          if (filename === null || filename === undefined) return void ingest.rescan();
          const parts = String(filename).split(/[\\/]/);
          const id = parts[0] ?? '';
          if (id === '' || id === 'alerts') return; // alerts are ingested separately
          const leaf = parts[parts.length - 1] ?? '';
          if (parts.length > 1 && (leaf.startsWith('.') || /\.tmp$/i.test(leaf))) return;
          schedule(id); // one debounce slot per folder
        });
        watcher.on('error', () => {
          /* rescan is the safety net */
        });
      } catch {
        /* watch unsupported: rescan only */
      }
      rescanTimer = timers.setTimeout(tickRescan, opts.rescanMs ?? FEED_RESCAN_MS);
      (rescanTimer as { unref?: () => void } | undefined)?.unref?.();
    },
    stop() {
      running = false;
      watcher?.close();
      watcher = undefined;
      if (rescanTimer !== undefined) timers.clearTimeout(rescanTimer);
      for (const h of pending.values()) timers.clearTimeout(h);
      pending.clear();
      ingest.dispose();
    },
  };
}
