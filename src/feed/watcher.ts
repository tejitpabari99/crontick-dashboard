/** fs.watch wiring for the feed ingest: recursive watch on feed/, 200 ms per-folder debounce, periodic rescan. */
import { watch, mkdirSync, type FSWatcher } from 'node:fs';
import { FEED_DEBOUNCE_MS, FEED_RESCAN_MS } from '../constants/feed.js';
import { realTimers, type TimeoutTimers } from '../utils/timers.js';
import { createFeedIngest, type FeedIngest, type FeedIngestOptions } from './ingest.js';

export type FeedEvent =
  | { kind: 'folder'; name: string }
  | { kind: 'alert'; name: string }
  | { kind: 'done'; name: string };

const ignorable = (leaf: string): boolean => leaf.startsWith('.') || /\.tmp$/i.test(leaf);

/**
 * Map an fs.watch event filename (relative to feed/, either separator) to what to re-evaluate.
 * `null` = drop (dot/.tmp files, directory events of alerts/ and alerts/.done; the rescan covers those).
 */
export function mapFeedEvent(filename: string): FeedEvent | null {
  const parts = filename.split(/[\\/]/).filter((p) => p !== '');
  const id = parts[0];
  if (id === undefined) return null;
  const leaf = parts[parts.length - 1] as string;
  if (id === 'alerts') {
    if (parts.length === 2 && !ignorable(leaf)) return { kind: 'alert', name: leaf };
    if (parts.length === 3 && parts[1] === '.done' && !ignorable(leaf)) return { kind: 'done', name: leaf };
    return null;
  }
  if (parts.length > 1 && ignorable(leaf)) return null;
  return { kind: 'folder', name: id }; // one debounce slot per folder (loose root files too)
}

export type WatchFn = (
  dir: string,
  opts: { persistent: boolean; recursive: boolean },
  listener: (event: string, filename: string | null) => void,
) => Pick<FSWatcher, 'close' | 'on'>;

export interface FeedWatcherOptions extends FeedIngestOptions {
  debounceMs?: number;
  rescanMs?: number;
  /** Injectable fs.watch (tests). */
  watchFn?: WatchFn;
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
  let watcher: Pick<FSWatcher, 'close' | 'on'> | undefined;
  const watchFn: WatchFn = opts.watchFn ?? (watch as unknown as WatchFn);
  let rescanTimer: unknown;
  let running = false;

  function schedule(name: string, kind: 'folder' | 'alert' | 'done' = 'folder'): void {
    const slot = `${kind}:${name}`;
    const old = pending.get(slot);
    if (old !== undefined) timers.clearTimeout(old);
    pending.set(
      slot,
      timers.setTimeout(() => {
        pending.delete(slot);
        if (kind === 'alert') ingest.processAlert(name);
        else if (kind === 'done') ingest.processCompletedAlert(name);
        else ingest.processFolder(name);
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
        watcher = watchFn(opts.feedDir, { persistent: false, recursive: true }, (_ev, filename) => {
          if (filename === null || filename === undefined) return void ingest.rescan();
          const ev = mapFeedEvent(String(filename));
          if (ev) schedule(ev.name, ev.kind);
        });
        watcher.on('error', () => ingest.rescan());
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
