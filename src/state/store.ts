/**
 * Durable owner state (state.json) with a single in-process serial writer.
 * Mutations queue; each applies in memory then writes state.json.tmp + atomic rename.
 * state.json is not created until the first mutation.
 */
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { rename as fsRename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { type Clock, realClock } from '../clock.js';
import { LAST_SEEN_GRANULARITY_MS, RENAME_TRIES, STATE_PRUNE_AFTER_MS, STATE_RENAME_BACKOFF_MS } from '../constants/state.js';
import { statePath } from '../paths.js';
import { errorMessage } from '../utils/errors.js';
import { retryOnBusy } from '../utils/retry.js';

const rec = <T extends z.ZodType>(v: T) => z.record(z.string(), v);
const CheckSchema = z.object({ updatedAt: z.string(), items: z.array(z.string()) });
const StateSchema = z.object({
  version: z.literal(1),
  acks: rec(z.string()),
  hidden: rec(z.literal(true)),
  layout: z.array(z.unknown()),
  checks: rec(CheckSchema),
  notified: rec(z.string()),
  lastSeen: rec(z.string()),
});

export interface CheckEntry {
  updatedAt: string;
  items: string[];
}
/** Per-id maps are null-prototype objects (ids are unconstrained, e.g. `__proto__`). */
export interface StateData {
  version: 1;
  acks: Record<string, string>;
  hidden: Record<string, true>;
  layout: unknown[];
  checks: Record<string, CheckEntry>;
  notified: Record<string, string>;
  lastSeen: Record<string, string>;
}

type MapKey = 'acks' | 'hidden' | 'checks' | 'notified' | 'lastSeen';
const MAP_KEYS: MapKey[] = ['acks', 'hidden', 'checks', 'notified', 'lastSeen'];

function nullMap<T>(src?: Record<string, T>): Record<string, T> {
  const out = Object.create(null) as Record<string, T>;
  if (src) for (const k of Object.keys(src)) out[k] = src[k] as T;
  return out;
}

function cloneChecks(src: Record<string, CheckEntry>): Record<string, CheckEntry> {
  const out = nullMap<CheckEntry>();
  for (const k of Object.keys(src)) out[k] = { updatedAt: src[k]!.updatedAt, items: [...src[k]!.items] };
  return out;
}

function snapshotOf(s: StateData): StateData {
  return {
    version: 1,
    acks: nullMap(s.acks),
    hidden: nullMap(s.hidden),
    layout: structuredClone(s.layout),
    checks: cloneChecks(s.checks),
    notified: nullMap(s.notified),
    lastSeen: nullMap(s.lastSeen),
  };
}

/** Restore `s` in place (callers hold the `get()` reference). */
function restore(s: StateData, from: StateData): void {
  s.acks = from.acks;
  s.hidden = from.hidden;
  s.layout = from.layout;
  s.checks = from.checks;
  s.notified = from.notified;
  s.lastSeen = from.lastSeen;
}

function defaults(): StateData {
  return {
    version: 1,
    acks: nullMap(),
    hidden: nullMap(),
    layout: [],
    checks: nullMap(),
    notified: nullMap(),
    lastSeen: nullMap(),
  };
}

export interface StateStoreOptions {
  env?: NodeJS.ProcessEnv;
  clock?: Clock;
  /** Test seam; defaults to fs.rename. */
  renameFn?: (from: string, to: string) => Promise<void>;
  /** Base backoff for EPERM rename retries (ms). */
  retryDelayMs?: number;
}

export interface StateStore {
  /** Current in-memory state (do not mutate). */
  get(): Readonly<StateData>;
  /** Warnings raised at load (e.g. corrupt file recovered). */
  readonly warnings: string[];
  ack(id: string, updatedAt: string): Promise<void>;
  unack(id: string): Promise<void>;
  hide(id: string, hidden: boolean): Promise<void>;
  setLayout(layout: unknown[]): Promise<void>;
  setChecks(id: string, updatedAt: string, items: string[]): Promise<void>;
  setNotified(id: string, updatedAt: string): Promise<void>;
  /** Marks present ids as seen now; prunes entries for ids absent > 30 days. */
  reconcile(presentIds: ReadonlySet<string>): Promise<void>;
  /** Generic serialized mutation. */
  /** `fn` may return `false` to signal "nothing changed" (skips the write). On write failure the in-memory state is rolled back. */
  mutate(fn: (state: StateData) => void | boolean): Promise<void>;
}

export function createStateStore(opts: StateStoreOptions = {}): StateStore {
  const env = opts.env ?? process.env;
  const clock = opts.clock ?? realClock;
  const renameFn = opts.renameFn ?? fsRename;
  const retryDelay = opts.retryDelayMs ?? STATE_RENAME_BACKOFF_MS;
  const file = statePath(env);
  const tmp = `${file}.tmp`;
  const warnings: string[] = [];

  const state = load();

  function load(): StateData {
    if (!existsSync(file)) return defaults();
    try {
      const raw: unknown = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      const parsed = StateSchema.parse(raw);
      // Rebuild maps from the raw object: zod's record drops `__proto__` keys.
      const rawObj = raw as Record<MapKey, Record<string, unknown>>;
      const copy = <T>(key: MapKey, v: z.ZodType<T>): Record<string, T> => {
        const out = nullMap<T>();
        for (const id of Object.keys(rawObj[key])) out[id] = v.parse(rawObj[key][id]);
        return out;
      };
      return {
        version: 1,
        acks: copy('acks', z.string()),
        hidden: copy('hidden', z.literal(true)),
        layout: parsed.layout,
        checks: copy('checks', CheckSchema),
        notified: copy('notified', z.string()),
        lastSeen: copy('lastSeen', z.string()),
      };
    } catch (err) {
      const ts = clock.now().toISOString().replace(/[:.]/g, '-');
      const moved = `${file}.corrupt-${ts}`;
      try {
        renameSync(file, moved);
      } catch {
        /* best effort */
      }
      warnings.push(
        `state.json was unreadable (${errorMessage(err).split('\n')[0]}); moved to ${moved}, starting with defaults`,
      );
      return defaults();
    }
  }

  async function write(): Promise<void> {
    mkdirSync(dirname(file), { recursive: true });
    await writeFile(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    await retryOnBusy(() => renameFn(tmp, file), { tries: RENAME_TRIES, backoffMs: retryDelay });
  }

  let queue: Promise<void> = Promise.resolve();
  function mutate(fn: (s: StateData) => void | boolean): Promise<void> {
    const run = queue.then(async () => {
      const before = snapshotOf(state);
      try {
        const changed = fn(state);
        if (changed === false) return;
        await write();
      } catch (err) {
        restore(state, before); // memory must not diverge from disk
        throw err;
      }
    });
    queue = run.catch(() => undefined);
    return run;
  }

  return {
    get: () => state,
    warnings,
    mutate,
    ack: (id, updatedAt) => mutate((s) => void (s.acks[id] = updatedAt)),
    unack: (id) => mutate((s) => void delete s.acks[id]),
    hide: (id, hidden) =>
      mutate((s) => {
        if (hidden) s.hidden[id] = true;
        else delete s.hidden[id];
      }),
    setLayout: (layout) => mutate((s) => void (s.layout = layout)),
    setChecks: (id, updatedAt, items) => mutate((s) => void (s.checks[id] = { updatedAt, items: [...items] })),
    setNotified: (id, updatedAt) => mutate((s) => void (s.notified[id] = updatedAt)),
    reconcile: (present) =>
      mutate((s) => {
        // No state.json until the first real mutation: nothing to track or prune before that.
        if (!existsSync(file)) return false;
        const now = clock.now();
        const nowIso = now.toISOString();
        let changed = false;
        const touch = (id: string): void => {
          s.lastSeen[id] = nowIso;
          changed = true;
        };
        const ids = new Set<string>();
        for (const k of MAP_KEYS) for (const id of Object.keys(s[k])) ids.add(id);
        for (const id of present) {
          const seen = Object.hasOwn(s.lastSeen, id) ? Date.parse(s.lastSeen[id]!) : NaN;
          // Coarse refresh (>1h) so hourly reconciles do not rewrite state.json for nothing.
          if (Number.isNaN(seen) || now.getTime() - seen > LAST_SEEN_GRANULARITY_MS) touch(id);
        }
        for (const id of ids) {
          if (present.has(id)) continue;
          const seen = Object.hasOwn(s.lastSeen, id) ? s.lastSeen[id] : undefined;
          const t = seen === undefined ? NaN : Date.parse(seen);
          if (Number.isNaN(t)) touch(id);
          else if (now.getTime() - t > STATE_PRUNE_AFTER_MS) {
            for (const k of MAP_KEYS) delete s[k][id];
            changed = true;
          }
        }
        return changed;
      }),
  };
}
