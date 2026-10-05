/** fs.watch wiring for the feed ingest: flat watch, 200 ms per-file debounce, periodic rescan. */
import { watch, mkdirSync, type FSWatcher } from 'node:fs';
import { FEED_DEBOUNCE_MS, FEED_RESCAN_MS } from '../constants/feed.js';
import { realTimers, type TimeoutTimers } from '../utils/timers.js';
import { createFeedIngest, isFeedFile, type FeedIngest, type FeedIngestOptions } from './ingest.js';

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
        ingest.processFile(name);
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
        watcher = watch(opts.feedDir, { persistent: false }, (_ev, filename) => {
          if (filename === null || filename === undefined) return void ingest.rescan();
          const name = String(filename);
          if (isFeedFile(name)) schedule(name);
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
