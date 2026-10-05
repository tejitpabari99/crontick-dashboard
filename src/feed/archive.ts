/**
 * Archive (D20): nothing-lost, deduped, restart-safe history of agent-authored card versions.
 * `archive/<id>/<updatedAt-safe>-<hash8>.json`. Newest hash is derived from disk, never memory.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDuration } from '../contract/formats.js';
import type { Clock } from '../clock.js';
import { ARCHIVE_FALLBACK_RETENTION_MS, ARCHIVE_PRUNE_INTERVAL_MS } from '../constants/feed.js';
import { realTimers, type IntervalTimers } from '../utils/timers.js';
import { envelope, type IngestInfo } from './ingest.js';

export interface ArchiveOptions {
  archiveDir: string;
  clock: Clock;
  /** Config `retentionDefault` (duration string), read at prune time. */
  retentionDefault: () => string;
  /**
   * Current feed cards: id -> card `retention` (undefined = use default). Ids absent here are
   * "removed cards" and get default retention with no keep-newest exemption.
   */
  cards: () => Map<string, string | undefined>;
  timers?: IntervalTimers;
}

export interface Archive {
  /** Hook for `createFeedIngest({ onIngest })`. Ignores server self-writes. */
  onIngest(info: IngestInfo): void;
  /** Prune every archive dir now. */
  pruneAll(): void;
  /** Start the hourly prune. */
  start(): void;
  stop(): void;
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) o[k] = canonical((v as Record<string, unknown>)[k]);
    return o;
  }
  return v;
}

/** sha256 of sorted-key compact JSON of the parsed text; undefined if not JSON. */
export function canonicalHash(text: string): string | undefined {
  try {
    return createHash('sha256').update(JSON.stringify(canonical(JSON.parse(text)))).digest('hex');
  } catch {
    return undefined;
  }
}

const safeStamp = (updatedAt: string): string => updatedAt.replace(/[^0-9A-Za-z.+-]/g, '-');
const validId = (id: string): boolean => id !== '' && id !== '.' && id !== '..' && !/[\\/\0:]/.test(id);
const HASH_RE = /-([0-9a-f]{8})\.json$/;

interface Version {
  name: string;
  mtimeMs: number;
}

export function createArchive(opts: ArchiveOptions): Archive {
  const timers = opts.timers ?? realTimers;
  let handle: unknown;

  function listVersions(dir: string): Version[] {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return [];
    }
    const out: Version[] = [];
    for (const name of names) {
      if (!HASH_RE.test(name)) continue;
      try {
        out.push({ name, mtimeMs: statSync(join(dir, name)).mtimeMs });
      } catch {
        /* vanished */
      }
    }
    // Newest last: archive time, then name.
    return out.sort((a, b) => a.mtimeMs - b.mtimeMs || (a.name < b.name ? -1 : 1));
  }

  function retentionMs(retention: string | undefined): number {
    for (const r of [retention, opts.retentionDefault()]) {
      if (r === undefined) continue;
      try {
        return parseDuration(r);
      } catch {
        /* fall through to default */
      }
    }
    return ARCHIVE_FALLBACK_RETENTION_MS;
  }

  function pruneId(id: string, retention: string | undefined, current: boolean): void {
    const dir = join(opts.archiveDir, id);
    const vs = listVersions(dir);
    if (vs.length === 0) {
      if (!current) rmEmpty(dir);
      return;
    }
    const cutoff = opts.clock.now().getTime() - retentionMs(retention);
    const newest = vs[vs.length - 1] as Version;
    for (const v of vs) {
      if (current && v === newest) continue;
      if (v.mtimeMs < cutoff) {
        try {
          rmSync(join(dir, v.name), { force: true });
        } catch {
          /* best effort */
        }
      }
    }
    if (!current) rmEmpty(dir);
  }

  function rmEmpty(dir: string): void {
    try {
      rmdirSync(dir); // only succeeds when empty
    } catch {
      /* not empty / gone */
    }
  }

  function pruneAll(): void {
    const cards = opts.cards();
    let ids: string[];
    try {
      ids = readdirSync(opts.archiveDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return;
    }
    for (const id of ids) pruneId(id, cards.get(id), cards.has(id));
  }

  function onIngest(info: IngestInfo): void {
    if (info.selfWrite) return;
    const e = envelope(info.card);
    const id = e.id;
    if (!validId(id)) return;
    const hash = canonicalHash(info.text);
    if (hash === undefined) return;
    const hash8 = hash.slice(0, 8);
    const dir = join(opts.archiveDir, id);
    const vs = listVersions(dir);
    const newest = vs[vs.length - 1];
    if (!newest || HASH_RE.exec(newest.name)?.[1] !== hash8) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const name = `${safeStamp(e.updatedAt)}-${hash8}.json`;
      const tmp = join(dir, `.${name}.tmp`);
      writeFileSync(tmp, info.text, { mode: 0o600 });
      const now = opts.clock.now();
      utimesSync(tmp, now, now);
      renameSync(tmp, join(dir, name));
    }
    pruneId(id, e.retention, true);
  }

  return {
    onIngest,
    pruneAll,
    start() {
      if (handle === undefined) handle = timers.setInterval(pruneAll, ARCHIVE_PRUNE_INTERVAL_MS);
    },
    stop() {
      if (handle !== undefined) timers.clearInterval(handle);
      handle = undefined;
    },
  };
}
