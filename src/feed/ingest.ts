/**
 * Feed ingest: turns feed/<id>/{card.json,data.json} folders into a CardStore, tolerant of partial writes,
 * any write order and bad files. Core is synchronous and timer-injectable; the fs.watch wiring lives in
 * watcher.ts. Cards are keyed by folder name; `alerts` is reserved and ingested separately (alerts / completedAlerts stores).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Layout } from '../contract/card-def.js';
import { CARD_DEF_FILE } from '../constants/contract.js';
import type { BrokenReason } from '../constants/error-codes.js';
import { FEED_SETTLE_DELAYS_MS } from '../constants/feed.js';
import { realClock, type Clock } from '../clock.js';
import type { NoDataCard, ValidAlert, ValidCard } from '../contract/folder-validate.js';
import { isCardFolderName, validateAlertFile, validateCardFolder } from '../contract/folder-validate.js';
import { sameInstant } from '../instant.js';
import { realTimers, type TimeoutTimers } from '../utils/timers.js';
import { readCardFolder, type CardFolderRead } from './read-card-folder.js';

/** Folder with a valid card.json and a valid data file. */
export interface OkEntry {
  status: 'ok';
  /** Store key = folder name = card id. */
  key: string;
  /** `<id>/<data file name>`: the selfWrites key and the watcher-relative path. */
  file: string;
  /** Absolute resolved data file path (write-back target). */
  dataPath: string;
  /** sha256 of card.json bytes. */
  viewHash: string;
  /** sha256 of the data file bytes. */
  dataHash: string;
  /** Effective updatedAt (data.updatedAt, else data file mtime ISO). */
  dataVersion: string;
  viewMtimeMs: number;
  dataMtimeMs: number;
  card: ValidCard;
  warnings: string[];
}

/** Valid card.json, data file absent. Shown muted; `staleAfter` reference = `viewMtimeMs`. */
export interface NoDataEntry {
  status: 'no-data';
  key: string;
  file: string;
  dataPath: string;
  viewHash: string;
  viewMtimeMs: number;
  card: NoDataCard;
  warnings: string[];
}

/** Folder shown as broken (bad/unreadable data, unknown type). */
export interface BrokenEntry {
  status: 'broken';
  key: string;
  file: string;
  id: string;
  title: string;
  reason: BrokenReason;
  message: string;
  viewHash: string;
  dataHash?: string;
  /** card.json layout when card.json parsed (so a broken card keeps its slot). */
  layout?: Layout;
  /** Best available mtime (data file, else card.json). */
  mtimeMs: number;
}
export type CardEntry = OkEntry | NoDataEntry | BrokenEntry;

export interface CardChange {
  type: 'new' | 'changed' | 'removed';
  key: string;
  file: string;
  entry?: CardEntry;
  prev?: CardEntry;
  /** True when the ingest that caused this change was a server write-back (never fires events). */
  selfWrite?: boolean;
  /** New entry, or data file bytes / effective updatedAt differ. False for card.json-only changes and removals. */
  contentChanged: boolean;
}

/** Valid file in feed/alerts/. */
export interface OkAlertEntry {
  status: 'ok';
  /** Store key = file stem = alert id. */
  key: string;
  /** `alerts/<stem>.json` (watcher-relative path). */
  file: string;
  /** sha256 of the file bytes. */
  hash: string;
  mtimeMs: number;
  alert: ValidAlert;
  warnings: string[];
}
/** Invalid alert file: kept as a tickable broken row. */
export interface BrokenAlertEntry {
  status: 'broken';
  key: string;
  file: string;
  id: string;
  /** Title when the file parsed far enough to have one, else the id. */
  title: string;
  reason: BrokenReason;
  message: string;
  hash: string;
  mtimeMs: number;
}
export type AlertEntry = OkAlertEntry | BrokenAlertEntry;

/** Ticked alert (`feed/alerts/.done/<stem>.json`); only valid files are kept. */
export interface CompletedAlertEntry {
  /** `.done` file stem (may carry a collision suffix). */
  key: string;
  file: string;
  title: string;
  text?: string;
  link?: string;
  priority: number;
  /** File mtime as ISO (the tick moved it and set mtime = tick time). */
  tickedAt: string;
  mtimeMs: number;
}

/** Change to `alerts` (never emitted for `.done/` files). Fires only when file content (hash) changed. */
export interface AlertChange {
  type: 'new' | 'changed' | 'removed';
  key: string;
  file: string;
  entry?: AlertEntry;
  prev?: AlertEntry;
  /** True for new alerts and when the file bytes changed; false for removals. */
  contentChanged: boolean;
}

export interface AlertStore {
  get(key: string): AlertEntry | undefined;
  list(): AlertEntry[];
}
export interface CompletedAlertStore {
  get(key: string): CompletedAlertEntry | undefined;
  list(): CompletedAlertEntry[];
}

export interface FeedIngestOptions {
  feedDir: string;
  timers?: TimeoutTimers;
  /** Time source for card validation (default real clock). */
  clock?: Clock;
  onChange?: (change: CardChange) => void;
  /** Alert file add/change/remove (for notifications). */
  onAlertChange?: (change: AlertChange) => void;
}

export interface CardStore {
  get(key: string): CardEntry | undefined;
  list(): CardEntry[];
}

export interface FeedIngest {
  store: CardStore;
  /** feed/alerts/*.json by file stem (ok and broken). */
  alerts: AlertStore;
  /** feed/alerts/.done/*.json by file stem (valid only). */
  completedAlerts: CompletedAlertStore;
  /** `<id>/data.json` -> sha256 hex of bytes the server wrote. Consumed on matching ingest. */
  selfWrites: Map<string, string>;
  /** Evaluate one feed/ child (folder, or loose file) now (synchronous). Also used after write-backs. */
  processFolder(id: string): void;
  /** Evaluate feed/alerts/<name> (file name `x.json`) now. Dot-prefixed, `.tmp` and non-.json names are ignored. */
  processAlert(name: string): void;
  /** Evaluate feed/alerts/.done/<name> now. Invalid files are skipped silently. */
  processCompletedAlert(name: string): void;
  /** Full scan: evaluate every child (feed/, alerts/, alerts/.done/), drop vanished ones. */
  rescan(): void;
  /** Stable warnings: skipped folders, loose files, folders without card.json. */
  issues(): string[];
  /** Cancel pending settling timers. */
  dispose(): void;
}

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const MISSING_CARD_WAIT_MS = FEED_SETTLE_DELAYS_MS[FEED_SETTLE_DELAYS_MS.length - 1] as number;

interface Settling {
  mtimeMs: number;
  attempt: number;
  timer: unknown;
}

/** card.json text that is empty or not parseable JSON (may be half-written). */
function malformedJson(text: string): boolean {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (src.trim() === '') return true;
  try {
    JSON.parse(src);
    return false;
  } catch {
    return true;
  }
}

export function createFeedIngest(opts: FeedIngestOptions): FeedIngest {
  const timers = opts.timers ?? realTimers;
  const clock = opts.clock ?? realClock;
  const entries = new Map<string, CardEntry>();
  const settling = new Map<string, Settling>();
  const missingTimers = new Map<string, unknown>();
  const issueMap = new Map<string, string>();
  const selfWrites = new Map<string, string>();
  const alertEntries = new Map<string, AlertEntry>();
  const doneEntries = new Map<string, CompletedAlertEntry>();
  const alertSettling = new Map<string, Settling>();
  const alertsDir = join(opts.feedDir, 'alerts');
  const doneDir = join(alertsDir, '.done');

  const alerts: AlertStore = { get: (k) => alertEntries.get(k), list: () => [...alertEntries.values()] };
  const completedAlerts: CompletedAlertStore = { get: (k) => doneEntries.get(k), list: () => [...doneEntries.values()] };

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

  const setIssue = (key: string, message: string): void => void issueMap.set(key, message);
  const clearIssue = (key: string): void => void issueMap.delete(key);

  // --- settling (per folder and file kind: `<id>:card` / `<id>:data`) ---

  function clearSettling(key: string): void {
    const s = settling.get(key);
    if (s) {
      timers.clearTimeout(s.timer);
      settling.delete(key);
    }
  }

  function arm(key: string, id: string, s: Settling): void {
    const delay = FEED_SETTLE_DELAYS_MS[s.attempt] as number;
    // Delays are cumulative from first failure: 250ms, 1s, 3s.
    const wait = s.attempt === 0 ? delay : delay - (FEED_SETTLE_DELAYS_MS[s.attempt - 1] as number);
    s.timer = timers.setTimeout(() => evaluate(id, key), wait);
  }

  /**
   * A file is malformed/unreadable. Returns 'final' when the settle schedule is exhausted (commit as
   * broken/skipped now), else 'waiting' (keep the previous entry). `tick` = this call is the timer firing.
   */
  function needSettle(key: string, id: string, mtimeMs: number, tick: boolean): 'final' | 'waiting' {
    const cur = settling.get(key);
    if (!cur) {
      const s: Settling = { mtimeMs, attempt: 0, timer: undefined };
      settling.set(key, s);
      arm(key, id, s);
      return 'waiting';
    }
    if (cur.mtimeMs !== mtimeMs) {
      // File still being written: restart the schedule.
      timers.clearTimeout(cur.timer);
      cur.mtimeMs = mtimeMs;
      cur.attempt = 0;
      arm(key, id, cur);
      return 'waiting';
    }
    if (!tick) return 'waiting'; // same mtime, schedule already running
    if (cur.attempt + 1 >= FEED_SETTLE_DELAYS_MS.length) {
      clearSettling(key);
      return 'final';
    }
    cur.attempt += 1;
    arm(key, id, cur);
    return 'waiting';
  }

  // --- entries ---

  function sig(e: CardEntry): string {
    switch (e.status) {
      case 'ok':
        return `ok|${e.viewHash}|${e.dataHash}|${e.dataVersion}`;
      case 'no-data':
        return `no-data|${e.viewHash}`;
      case 'broken':
        return `broken|${e.viewHash}|${e.dataHash ?? ''}|${e.reason}|${e.message}`;
    }
  }
  const dataHashOf = (e: CardEntry | undefined): string | undefined =>
    e?.status === 'ok' || e?.status === 'broken' ? e.dataHash : undefined;
  const versionOf = (e: CardEntry | undefined): string | undefined => (e?.status === 'ok' ? e.dataVersion : undefined);

  function commit(entry: CardEntry): void {
    const prev = entries.get(entry.key);
    entries.set(entry.key, entry);
    if (prev && sig(prev) === sig(entry)) return; // same content: mtime-only refresh, no change
    let selfWrite = false;
    if (entry.status === 'ok' && dataHashOf(prev) !== entry.dataHash) {
      selfWrite = selfWrites.get(entry.file) === entry.dataHash;
      if (selfWrite) selfWrites.delete(entry.file);
    }
    const pv = versionOf(prev);
    const ev = versionOf(entry);
    const contentChanged =
      !prev ||
      dataHashOf(prev) !== dataHashOf(entry) ||
      (pv === undefined) !== (ev === undefined) ||
      (pv !== undefined && ev !== undefined && !sameInstant(pv, ev));
    emit({
      type: prev ? 'changed' : 'new',
      key: entry.key,
      file: entry.file,
      entry,
      ...(prev ? { prev } : {}),
      ...(selfWrite ? { selfWrite } : {}),
      contentChanged,
    });
  }

  function dropEntry(id: string): void {
    const prev = entries.get(id);
    if (!prev) return;
    entries.delete(id);
    emit({ type: 'removed', key: id, file: prev.file, prev, contentChanged: false });
  }

  function forget(id: string): void {
    clearSettling(`${id}:card`);
    clearSettling(`${id}:data`);
    const m = missingTimers.get(id);
    if (m !== undefined) {
      timers.clearTimeout(m);
      missingTimers.delete(id);
    }
    clearIssue(`feed:${id}`);
    clearIssue(`loose:${id}`);
    for (const k of [...selfWrites.keys()]) if (k.startsWith(`${id}/`)) selfWrites.delete(k);
  }

  // --- evaluation ---

  function evaluate(id: string, tickKey?: string): void {
    const dir = join(opts.feedDir, id);
    let st;
    try {
      st = statSync(dir);
    } catch {
      forget(id);
      dropEntry(id);
      return;
    }
    if (!st.isDirectory()) {
      // Loose file in feed/ root: never a card.
      clearSettling(`${id}:card`);
      clearSettling(`${id}:data`);
      dropEntry(id);
      if (id.startsWith('.') || /\.tmp$/i.test(id)) return clearIssue(`loose:${id}`);
      setIssue(`loose:${id}`, `feed/${id} ignored: panels are folders (feed/<id>/card.json)`);
      return;
    }
    clearIssue(`loose:${id}`);
    const kind = isCardFolderName(id);
    if (kind === 'ignore' || kind === 'reserved') {
      forget(id);
      dropEntry(id);
      return;
    }

    const read = readCardFolder(dir);
    evaluateRead(id, read, tickKey);
  }

  function evaluateRead(id: string, read: CardFolderRead, tickKey?: string): void {
    const cardKey = `${id}:card`;
    const dataKey = `${id}:data`;
    const result =
      read.preset ??
      validateCardFolder({ folderId: id, cardText: read.cardText, data: read.data, now: clock.now() });

    if (result.status === 'skipped') {
      clearSettling(dataKey);
      if (result.reason === 'card-def-missing') {
        clearSettling(cardKey);
        dropEntry(id);
        clearIssue(`feed:${id}`);
        const fired = tickKey === `${id}:missing`;
        if (fired) {
          missingTimers.delete(id);
          setIssue(`feed:${id}`, `feed/${id} ignored: ${CARD_DEF_FILE} is missing`);
        } else if (!missingTimers.has(id)) {
          missingTimers.set(
            id,
            timers.setTimeout(() => evaluate(id, `${id}:missing`), MISSING_CARD_WAIT_MS),
          );
        }
        return;
      }
      const mt = missingTimers.get(id);
      if (mt !== undefined) {
        timers.clearTimeout(mt);
        missingTimers.delete(id);
      }
      const cardBad =
        result.reason === 'card-def-invalid' &&
        (read.preset !== undefined || (read.cardText !== null && malformedJson(read.cardText)));
      if (cardBad) {
        const mtime = read.cardMtimeMs ?? 0;
        if (needSettle(cardKey, id, mtime, tickKey === cardKey) === 'waiting') return; // keep previous entry
      } else clearSettling(cardKey);
      dropEntry(id);
      setIssue(`feed:${id}`, `feed/${id} skipped: ${result.message}`);
      return;
    }

    // card.json parsed: folder is shown.
    clearSettling(cardKey);
    const mt = missingTimers.get(id);
    if (mt !== undefined) {
      timers.clearTimeout(mt);
      missingTimers.delete(id);
    }
    clearIssue(`feed:${id}`);
    const viewHash = sha256(read.cardText ?? '');
    const viewMtimeMs = read.cardMtimeMs ?? 0;
    const dataName = read.dataPath ?? 'data.json';
    const file = `${id}/${dataName}`;
    const dataPath = join(opts.feedDir, id, dataName);

    if (result.status === 'broken') {
      const dataMtime = 'text' in read.data ? read.data.mtimeMs : 0;
      const dataText = 'text' in read.data ? read.data.text : undefined;
      const retry = result.reason === 'malformed-json' || result.reason === 'unreadable';
      if (retry) {
        const mtime = dataMtime || viewMtimeMs;
        if (needSettle(dataKey, id, mtime, tickKey === dataKey) === 'waiting') return; // keep previous entry
      } else clearSettling(dataKey);
      commit({
        status: 'broken',
        key: id,
        file,
        id,
        title: result.def?.title ?? id,
        reason: result.reason,
        message: result.message,
        viewHash,
        ...(dataText !== undefined ? { dataHash: sha256(dataText) } : {}),
        ...(result.def ? { layout: result.def.layout } : {}),
        mtimeMs: dataMtime || viewMtimeMs,
      });
      return;
    }

    clearSettling(dataKey);
    if (result.status === 'no-data') {
      commit({ status: 'no-data', key: id, file, dataPath, viewHash, viewMtimeMs, card: result.card, warnings: result.warnings });
      return;
    }
    const data = read.data as { text: string; mtimeMs: number };
    commit({
      status: 'ok',
      key: id,
      file,
      dataPath,
      viewHash,
      dataHash: sha256(data.text),
      dataVersion: result.card.updatedAt,
      viewMtimeMs,
      dataMtimeMs: data.mtimeMs,
      card: result.card,
      warnings: result.warnings,
    });
  }

  // --- alerts ---

  /** Stem of a `*.json` alert file name, or undefined when the name is not an alert file (ignored). */
  function alertStem(name: string): string | undefined {
    if (name.startsWith('.') || /\.tmp$/i.test(name)) return undefined;
    const m = /^(.+)\.json$/i.exec(name);
    return m ? (m[1] as string) : undefined;
  }

  function emitAlert(c: AlertChange): void {
    try {
      opts.onAlertChange?.(c);
    } catch {
      /* listener errors must not break ingest */
    }
  }

  function dropAlert(key: string): void {
    const s = alertSettling.get(key);
    if (s) {
      timers.clearTimeout(s.timer);
      alertSettling.delete(key);
    }
    const prev = alertEntries.get(key);
    if (!prev) return;
    alertEntries.delete(key);
    emitAlert({ type: 'removed', key, file: prev.file, prev, contentChanged: false });
  }

  /** Same schedule as card files; own map so card settling keys never mix with alert stems. */
  function alertNeedSettle(key: string, mtimeMs: number, tick: boolean): 'final' | 'waiting' {
    const arm = (s: Settling): void => {
      const delay = FEED_SETTLE_DELAYS_MS[s.attempt] as number;
      const wait = s.attempt === 0 ? delay : delay - (FEED_SETTLE_DELAYS_MS[s.attempt - 1] as number);
      s.timer = timers.setTimeout(() => evaluateAlert(key, true), wait);
    };
    const cur = alertSettling.get(key);
    if (!cur) {
      const s: Settling = { mtimeMs, attempt: 0, timer: undefined };
      alertSettling.set(key, s);
      arm(s);
      return 'waiting';
    }
    if (cur.mtimeMs !== mtimeMs) {
      timers.clearTimeout(cur.timer);
      cur.mtimeMs = mtimeMs;
      cur.attempt = 0;
      arm(cur);
      return 'waiting';
    }
    if (!tick) return 'waiting';
    if (cur.attempt + 1 >= FEED_SETTLE_DELAYS_MS.length) {
      alertSettling.delete(key);
      return 'final';
    }
    cur.attempt += 1;
    arm(cur);
    return 'waiting';
  }

  function evaluateAlert(stem: string, tick = false): void {
    const name = `${stem}.json`;
    const path = join(alertsDir, name);
    let mtimeMs: number;
    let text: string | undefined;
    try {
      const st = statSync(path);
      if (!st.isFile()) return dropAlert(stem);
      mtimeMs = st.mtimeMs;
    } catch {
      return dropAlert(stem);
    }
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      text = undefined;
    }
    const res =
      text === undefined
        ? ({ status: 'broken', reason: 'unreadable', message: 'file is not readable', issues: [], id: stem } as const)
        : validateAlertFile({ name, text, mtimeMs, now: clock.now() });
    const file = `alerts/${name}`;
    const hash = sha256(text ?? '');
    let entry: AlertEntry;
    if (res.status === 'ok') {
      const s = alertSettling.get(stem);
      if (s) {
        timers.clearTimeout(s.timer);
        alertSettling.delete(stem);
      }
      entry = { status: 'ok', key: stem, file, hash, mtimeMs, alert: res.alert, warnings: res.warnings };
    } else {
      if (res.reason === 'malformed-json' || res.reason === 'unreadable') {
        if (alertNeedSettle(stem, mtimeMs, tick) === 'waiting') return; // keep previous entry
      } else {
        const s = alertSettling.get(stem);
        if (s) {
          timers.clearTimeout(s.timer);
          alertSettling.delete(stem);
        }
      }
      let title = stem;
      try {
        const o = JSON.parse(text ?? '') as unknown;
        const t = o !== null && typeof o === 'object' ? (o as { title?: unknown }).title : undefined;
        if (typeof t === 'string' && t.trim() !== '') title = t;
      } catch {
        /* keep stem */
      }
      entry = { status: 'broken', key: stem, file, id: stem, title, reason: res.reason, message: res.message, hash, mtimeMs };
    }
    const prev = alertEntries.get(stem);
    alertEntries.set(stem, entry);
    if (prev && prev.hash === entry.hash) return; // mtime-only refresh
    emitAlert({ type: prev ? 'changed' : 'new', key: stem, file, entry, ...(prev ? { prev } : {}), contentChanged: true });
  }

  function processAlert(name: string): void {
    const stem = alertStem(name);
    if (stem !== undefined) evaluateAlert(stem);
  }

  function evaluateCompleted(stem: string): void {
    const name = `${stem}.json`;
    const path = join(doneDir, name);
    try {
      const st = statSync(path);
      if (!st.isFile()) throw new Error('not a file');
      const res = validateAlertFile({ name, text: readFileSync(path, 'utf8'), mtimeMs: st.mtimeMs, now: clock.now() });
      if (res.status !== 'ok') throw new Error('invalid');
      const a = res.alert;
      doneEntries.set(stem, {
        key: stem,
        file: `alerts/.done/${name}`,
        title: a.title,
        ...(a.text !== undefined ? { text: a.text } : {}),
        ...(a.link !== undefined ? { link: a.link } : {}),
        priority: a.priority,
        tickedAt: new Date(st.mtimeMs).toISOString(),
        mtimeMs: st.mtimeMs,
      });
    } catch {
      doneEntries.delete(stem); // missing or invalid: silently no row
    }
  }

  function processCompletedAlert(name: string): void {
    const stem = alertStem(name);
    if (stem !== undefined) evaluateCompleted(stem);
  }

  function rescanAlerts(): void {
    const list = (dir: string): Set<string> => {
      try {
        return new Set(readdirSync(dir).flatMap((n) => alertStem(n) ?? []));
      } catch {
        return new Set();
      }
    };
    const live = list(alertsDir);
    for (const k of new Set([...alertEntries.keys(), ...alertSettling.keys()])) if (!live.has(k)) evaluateAlert(k);
    for (const k of live) evaluateAlert(k);
    const done = list(doneDir);
    for (const k of [...doneEntries.keys()]) if (!done.has(k)) evaluateCompleted(k);
    for (const k of done) evaluateCompleted(k);
  }

  function processFolder(id: string): void {
    evaluate(id);
  }

  function rescan(): void {
    let names: string[] = [];
    try {
      names = readdirSync(opts.feedDir).filter((n) => !n.startsWith('.'));
    } catch {
      /* feed dir missing: treat as empty */
    }
    const present = new Set(names);
    const known = new Set<string>([...entries.keys()]);
    for (const k of settling.keys()) known.add(k.slice(0, k.lastIndexOf(':')));
    for (const k of missingTimers.keys()) known.add(k);
    for (const k of issueMap.keys()) known.add(k.slice(k.indexOf(':') + 1));
    for (const id of known) if (!present.has(id)) evaluate(id);
    for (const id of names) evaluate(id);
    rescanAlerts();
  }

  return {
    store,
    alerts,
    completedAlerts,
    selfWrites,
    processFolder,
    processAlert,
    processCompletedAlert,
    rescan,
    issues: () => [...issueMap.values()],
    dispose() {
      for (const k of [...settling.keys()]) clearSettling(k);
      for (const t of missingTimers.values()) timers.clearTimeout(t);
      missingTimers.clear();
      for (const s of alertSettling.values()) timers.clearTimeout(s.timer);
      alertSettling.clear();
    },
  };
}
