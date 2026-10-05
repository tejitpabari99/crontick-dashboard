/**
 * Feed ingest: turns feed/*.json into a CardStore, tolerant of partial writes and bad files.
 * Core is synchronous and timer-injectable; the fs.watch wiring lives in watcher.ts.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_BYTES, validateCardFile, type Card, type BrokenReason } from '../contract/validate.js';

export type StoredReason = BrokenReason | 'duplicate-id';

export interface OkEntry {
  status: 'ok';
  /** Store key = card id. */
  key: string;
  file: string;
  hash: string;
  mtimeMs: number;
  card: Card;
}
export interface BrokenEntry {
  status: 'broken';
  /** `broken.id` (reason != id-mismatch, not shadowing a valid card) else `file:<name>`. */
  key: string;
  file: string;
  hash: string;
  mtimeMs: number;
  id?: string;
  title: string;
  reason: StoredReason;
  message: string;
}
export type CardEntry = OkEntry | BrokenEntry;

export interface CardChange {
  type: 'new' | 'changed' | 'removed';
  key: string;
  file: string;
  entry?: CardEntry;
  prev?: CardEntry;
}

/** Fired for every accepted (valid) ingest, before the store is rebuilt. Seam for archive (T4) / self-write (T10). */
export interface IngestInfo {
  file: string;
  text: string;
  hash: string;
  mtimeMs: number;
  card: Card;
  /** True when hash equals (and consumes) a registered `selfWrites[file]` entry. */
  selfWrite: boolean;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface FeedIngestOptions {
  feedDir: string;
  timers?: Timers;
  onIngest?: (info: IngestInfo) => void;
  onChange?: (change: CardChange) => void;
}

export interface CardStore {
  get(key: string): CardEntry | undefined;
  list(): CardEntry[];
}

export interface FeedIngest {
  store: CardStore;
  /** file name -> sha256 hex of bytes the server wrote (Task 10). Consumed on matching ingest. */
  selfWrites: Map<string, string>;
  /** Ingest one file now (synchronous). Also used after server write-backs. */
  processFile(name: string): void;
  /** Full scan: ingest changed/new files, drop vanished ones. */
  rescan(): void;
  /** Cancel pending settling timers. */
  dispose(): void;
}

export const SETTLE_DELAYS_MS = [250, 1000, 3000] as const;

const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

export function isFeedFile(name: string): boolean {
  return /\.json$/i.test(name) && !name.startsWith('.') && !/\.tmp$/i.test(name);
}

type Parsed =
  | { ok: true; card: Card }
  | { ok: false; reason: BrokenReason; message: string; id?: string };

interface FileRec {
  name: string;
  hash: string;
  mtimeMs: number;
  size: number;
  parsed: Parsed;
}

interface Settling {
  mtimeMs: number;
  attempt: number;
  timer: unknown;
}

type ReadResult =
  | { kind: 'gone' }
  | { kind: 'dir' }
  | { kind: 'toolarge'; mtimeMs: number; size: number }
  | { kind: 'error'; mtimeMs: number; size: number; message: string }
  | { kind: 'read'; mtimeMs: number; size: number; buf: Buffer };

const RETRY_CODES = new Set(['EBUSY', 'EPERM']);

function readFeedFile(path: string): ReadResult {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const st = statSync(path);
      if (st.isDirectory()) return { kind: 'dir' };
      if (st.size > MAX_BYTES) return { kind: 'toolarge', mtimeMs: st.mtimeMs, size: st.size };
      const buf = readFileSync(path);
      return { kind: 'read', mtimeMs: st.mtimeMs, size: st.size, buf };
    } catch (e) {
      last = e;
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (code === 'ENOENT') return { kind: 'gone' };
      if (!RETRY_CODES.has(code)) break;
    }
  }
  return { kind: 'error', mtimeMs: 0, size: 0, message: last instanceof Error ? last.message : String(last) };
}

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

export function createFeedIngest(opts: FeedIngestOptions): FeedIngest {
  const timers = opts.timers ?? realTimers;
  const recs = new Map<string, FileRec>();
  const settling = new Map<string, Settling>();
  const selfWrites = new Map<string, string>();
  let entries = new Map<string, CardEntry>();

  const store: CardStore = {
    get: (key) => entries.get(key),
    list: () => [...entries.values()],
  };

  function emit(c: CardChange): void {
    try {
      opts.onChange?.(c);
    } catch {
      /* listener errors must not break ingest */
    }
  }

  function stamp(card: Card): number {
    const t = Date.parse(String(card['updatedAt']));
    return Number.isNaN(t) ? 0 : t;
  }

  function rebuild(): void {
    const next = new Map<string, CardEntry>();
    const okByKey = new Map<string, FileRec[]>();
    const broken: FileRec[] = [];
    for (const r of recs.values()) {
      if (r.parsed.ok) {
        const id = String(r.parsed.card['id']);
        const list = okByKey.get(id) ?? [];
        list.push(r);
        okByKey.set(id, list);
      } else broken.push(r);
    }
    for (const [id, list] of okByKey) {
      const sorted = [...list].sort((a, b) => {
        const ua = stamp((a.parsed as { card: Card }).card);
        const ub = stamp((b.parsed as { card: Card }).card);
        return ub - ua || b.mtimeMs - a.mtimeMs || (a.name < b.name ? -1 : 1);
      });
      const win = sorted[0] as FileRec;
      const wp = win.parsed as { ok: true; card: Card };
      next.set(id, { status: 'ok', key: id, file: win.name, hash: win.hash, mtimeMs: win.mtimeMs, card: wp.card });
      for (const lose of sorted.slice(1)) {
        const key = `file:${lose.name}`;
        next.set(key, {
          status: 'broken',
          key,
          file: lose.name,
          hash: lose.hash,
          mtimeMs: lose.mtimeMs,
          id,
          title: id,
          reason: 'duplicate-id',
          message: `duplicate id \`${id}\` also in \`${win.name}\``,
        });
      }
    }
    // Broken files whose stem equals their id claim the id key first.
    const stem = (n: string): string => n.replace(/\.json$/i, '');
    broken.sort((a, b) => {
      const sa = a.parsed.ok === false && a.parsed.id === stem(a.name) ? 0 : 1;
      const sb = b.parsed.ok === false && b.parsed.id === stem(b.name) ? 0 : 1;
      return sa - sb || (a.name < b.name ? -1 : 1);
    });
    for (const r of broken) {
      const p = r.parsed as Extract<Parsed, { ok: false }>;
      const idKey = p.id !== undefined && p.reason !== 'id-mismatch' && !next.has(p.id) ? p.id : undefined;
      const key = idKey ?? `file:${r.name}`;
      next.set(key, {
        status: 'broken',
        key,
        file: r.name,
        hash: r.hash,
        mtimeMs: r.mtimeMs,
        ...(p.id !== undefined ? { id: p.id } : {}),
        title: p.id ?? r.name,
        reason: p.reason,
        message: p.message,
      });
    }

    const prev = entries;
    entries = next;
    for (const [key, e] of next) {
      const old = prev.get(key);
      if (!old) emit({ type: 'new', key, file: e.file, entry: e });
      else if (old.hash !== e.hash || old.file !== e.file || old.status !== e.status || (old.status === 'broken' && e.status === 'broken' && old.message !== e.message))
        emit({ type: 'changed', key, file: e.file, entry: e, prev: old });
    }
    for (const [key, old] of prev) if (!next.has(key)) emit({ type: 'removed', key, file: old.file, prev: old });
  }

  function clearSettling(name: string): void {
    const s = settling.get(name);
    if (s) {
      timers.clearTimeout(s.timer);
      settling.delete(name);
    }
  }

  function setRec(name: string, rec: FileRec): void {
    recs.set(name, rec);
    rebuild();
  }

  function remove(name: string): void {
    clearSettling(name);
    selfWrites.delete(name);
    if (recs.delete(name)) rebuild();
  }

  /** Schedule next settle check for a file whose content is malformed/unreadable. */
  function settle(name: string, mtimeMs: number, restart: boolean): void {
    const cur = settling.get(name);
    let attempt = 0;
    if (cur && !restart) attempt = cur.attempt;
    if (cur) timers.clearTimeout(cur.timer);
    const delay = SETTLE_DELAYS_MS[attempt] as number;
    // Delays are cumulative from first failure: 250ms, 1s, 3s.
    const wait = attempt === 0 ? delay : delay - (SETTLE_DELAYS_MS[attempt - 1] as number);
    const s: Settling = {
      mtimeMs,
      attempt,
      timer: timers.setTimeout(() => settleTick(name), wait),
    };
    settling.set(name, s);
  }

  function settleTick(name: string): void {
    const s = settling.get(name);
    if (!s) return;
    const r = readFeedFile(join(opts.feedDir, name));
    if (r.kind === 'gone' || r.kind === 'dir') return remove(name);
    const mtime = r.kind === 'error' ? s.mtimeMs : r.mtimeMs;
    const changed = mtime !== s.mtimeMs;
    // Re-evaluate; if still malformed, decide whether to keep settling.
    const outcome = evaluate(name, r);
    if (outcome !== 'settling') return;
    if (changed) {
      s.mtimeMs = mtime;
      settle(name, mtime, true); // file still being written: restart the schedule
      return;
    }
    if (s.attempt + 1 >= SETTLE_DELAYS_MS.length) {
      finalizeBroken(name, r);
      return;
    }
    s.attempt += 1;
    settle(name, mtime, false);
  }

  function parseRead(name: string, r: ReadResult & { kind: 'read' }): { text: string; hash: string; parsed: Parsed } {
    const text = r.buf.toString('utf8');
    const hash = sha256(r.buf);
    const v = validateCardFile(text, { filename: name });
    const parsed: Parsed = 'broken' in v ? { ok: false, reason: v.reason, message: v.message, ...(v.id !== undefined ? { id: v.id } : {}) } : { ok: true, card: v.card };
    return { text, hash, parsed };
  }

  function finalizeBroken(name: string, r: ReadResult): void {
    clearSettling(name);
    if (r.kind === 'read') {
      const { hash, parsed } = parseRead(name, r);
      setRec(name, { name, hash, mtimeMs: r.mtimeMs, size: r.size, parsed });
    } else if (r.kind === 'error') {
      const prev = recs.get(name);
      setRec(name, {
        name,
        hash: '',
        mtimeMs: prev?.mtimeMs ?? 0,
        size: -1,
        parsed: { ok: false, reason: 'unreadable', message: `could not read file: ${r.message}` },
      });
    }
  }

  /**
   * Evaluate a read result. Returns 'settling' when the content is malformed/unreadable and the caller
   * must decide (retry or finalize); otherwise the record is committed and 'done' returned.
   */
  function evaluate(name: string, r: ReadResult): 'done' | 'settling' {
    if (r.kind === 'gone' || r.kind === 'dir') {
      remove(name);
      return 'done';
    }
    if (r.kind === 'toolarge') {
      clearSettling(name);
      setRec(name, {
        name,
        hash: `size:${r.size}`,
        mtimeMs: r.mtimeMs,
        size: r.size,
        parsed: { ok: false, reason: 'too-large', message: 'file is larger than 1 MB' },
      });
      return 'done';
    }
    if (r.kind === 'error') return 'settling';
    const { text, hash, parsed } = parseRead(name, r);
    if (!parsed.ok && (parsed.reason === 'malformed-json' || parsed.reason === 'unreadable')) return 'settling';
    clearSettling(name);
    const rec: FileRec = { name, hash, mtimeMs: r.mtimeMs, size: r.size, parsed };
    // Same bytes and mtime already ingested (e.g. watcher event after a synchronous write-back refresh): no hook call.
    const prevRec = recs.get(name);
    if (parsed.ok && !(prevRec?.hash === hash && prevRec.mtimeMs === r.mtimeMs)) {
      const selfWrite = selfWrites.get(name) === hash;
      if (selfWrite) selfWrites.delete(name);
      try {
        opts.onIngest?.({ file: name, text, hash, mtimeMs: r.mtimeMs, card: parsed.card, selfWrite });
      } catch {
        /* hook errors must not break ingest */
      }
    }
    setRec(name, rec);
    return 'done';
  }

  function processFile(name: string): void {
    if (!isFeedFile(name)) return;
    const r = readFeedFile(join(opts.feedDir, name));
    if (evaluate(name, r) === 'settling') {
      const mtime = r.kind === 'read' || r.kind === 'toolarge' ? r.mtimeMs : 0;
      const cur = settling.get(name);
      // A fresh event with a new mtime restarts the schedule; same mtime keeps it running.
      if (!cur || cur.mtimeMs !== mtime) settle(name, mtime, true);
    }
  }

  function rescan(): void {
    let names: string[] = [];
    try {
      names = readdirSync(opts.feedDir, { withFileTypes: true })
        .filter((d) => !d.isDirectory() && isFeedFile(d.name))
        .map((d) => d.name);
    } catch {
      /* feed dir missing: treat as empty */
    }
    const present = new Set(names);
    for (const name of [...recs.keys(), ...settling.keys()]) if (!present.has(name)) remove(name);
    for (const name of names) {
      const rec = recs.get(name);
      const cur = settling.get(name);
      let mtime: number;
      let size: number;
      try {
        const st = statSync(join(opts.feedDir, name));
        mtime = st.mtimeMs;
        size = st.size;
      } catch {
        remove(name);
        continue;
      }
      if (cur && cur.mtimeMs === mtime) continue; // still settling, unchanged
      if (!cur && rec && rec.mtimeMs === mtime && rec.size === size) continue; // unchanged
      processFile(name);
    }
  }

  return {
    store,
    selfWrites,
    processFile,
    rescan,
    dispose() {
      for (const name of [...settling.keys()]) clearSettling(name);
    },
  };
}
