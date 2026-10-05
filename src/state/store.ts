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
import { statePath } from '../paths.js';

export const PRUNE_AFTER_MS = 30 * 86_400_000;

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
  mutate(fn: (state: StateData) => void): Promise<void>;
}

const RENAME_TRIES = 5;

export function createStateStore(opts: StateStoreOptions = {}): StateStore {
  const env = opts.env ?? process.env;
  const clock = opts.clock ?? realClock;
  const renameFn = opts.renameFn ?? fsRename;
  const retryDelay = opts.retryDelayMs ?? 20;
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
        `state.json was unreadable (${err instanceof Error ? err.message.split('\n')[0] : String(err)}); moved to ${moved}, starting with defaults`,
      );
      return defaults();
    }
  }

  async function write(): Promise<void> {
    mkdirSync(dirname(file), { recursive: true });
    await writeFile(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    for (let attempt = 1; ; attempt++) {
      try {
        await renameFn(tmp, file);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'EPERM' || attempt >= RENAME_TRIES) throw err;
        await new Promise((r) => setTimeout(r, retryDelay * 2 ** (attempt - 1)));
      }
    }
  }

  let queue: Promise<void> = Promise.resolve();
  function mutate(fn: (s: StateData) => void): Promise<void> {
    const run = queue.then(async () => {
      fn(state);
      await write();
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
        const now = clock.now();
        const nowIso = now.toISOString();
        const ids = new Set<string>();
        for (const k of MAP_KEYS) for (const id of Object.keys(s[k])) ids.add(id);
        for (const id of present) s.lastSeen[id] = nowIso;
        for (const id of ids) {
          if (present.has(id)) continue;
          const seen = s.lastSeen[id];
          if (seen === undefined) {
            s.lastSeen[id] = nowIso;
            continue;
          }
          const t = Date.parse(seen);
          if (Number.isNaN(t)) {
            s.lastSeen[id] = nowIso;
          } else if (now.getTime() - t > PRUNE_AFTER_MS) {
            for (const k of MAP_KEYS) delete s[k][id];
          }
        }
      }),
  };
}
