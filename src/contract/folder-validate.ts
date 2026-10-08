import { realClock } from '../clock.js';
import {
  CLOCK_SKEW_MS,
  ID_PATTERN,
  MAX_ALERT_BYTES,
  MAX_CARD_BYTES,
  MAX_CARD_DEF_BYTES,
} from '../constants/contract.js';
import type { BrokenReason, SkipReason } from '../constants/error-codes.js';
import { MS_PER_MINUTE } from '../constants/time.js';
import { errorMessage } from '../utils/errors.js';
import { alertSchema, type Alert } from './alert.js';
import { cardDefSchema, hasStrayId, type CardDef } from './card-def.js';
import { dataFileSchema } from './data-file.js';
import { isRegisteredType, registry } from './registry.js';

export interface FolderIssue {
  path: string;
  message: string;
}

type Obj = Record<string, unknown>;

/** Result of step 1: card.json parsed. `dataPath` is what SP02 must read next. */
export type DefResult =
  | { status: 'ok'; id: string; def: CardDef; raw: Obj; dataPath: string; warnings: string[] }
  | SkippedResult;

export interface SkippedResult {
  status: 'skipped';
  reason: SkipReason;
  message: string;
  issues: FolderIssue[];
  id?: string;
}

export interface BrokenResult {
  status: 'broken';
  reason: BrokenReason;
  message: string;
  issues: FolderIssue[];
  id: string;
  /** Parsed card.json (defaults applied), present whenever card.json parsed. */
  def?: CardDef;
}

export type UpdatedAtSource = 'data' | 'mtime';

export interface ValidCard {
  id: string;
  type: string;
  title: string;
  layout: CardDef['layout'];
  /** data.priority ?? card.priority ?? 2 */
  priority: number;
  notify: boolean;
  show?: CardDef['show'];
  staleAfter?: string;
  /** Effective updatedAt (RFC 3339): data.updatedAt, else ISO(mtime). */
  updatedAt: string;
  updatedAtSource: UpdatedAtSource;
  error: string | null;
  /** Validated payload; omitted when `error` is set (payload not validated). */
  data?: Obj;
  /** Raw parsed card.json, kept for write-back. */
  def: Obj;
  /** Raw parsed data file, kept for write-back. */
  content: Obj;
}

export interface NoDataCard {
  id: string;
  type: string;
  title: string;
  layout: CardDef['layout'];
  priority: number;
  notify: boolean;
  show?: CardDef['show'];
  staleAfter?: string;
  def: Obj;
}

export type FolderResult =
  | { status: 'ok'; card: ValidCard; warnings: string[] }
  | { status: 'no-data'; card: NoDataCard; warnings: string[] }
  | BrokenResult
  | SkippedResult;

export interface ValidAlert {
  id: string;
  title: string;
  text?: string;
  link?: string;
  priority: number;
  notify: boolean;
  show?: Alert['show'];
  updatedAt: string;
  updatedAtSource: UpdatedAtSource;
  /** Raw parsed alert file, kept for write-back. */
  raw: Obj;
}

export type AlertResult =
  | { status: 'ok'; alert: ValidAlert; warnings: string[] }
  | {
      status: 'broken';
      reason: Exclude<BrokenReason, 'unknown-type'>;
      message: string;
      issues: FolderIssue[];
      id: string;
    };

export type DataInput = { text: string; mtimeMs: number } | { absent: true } | { unreadable: string };

export interface ValidateCardFolderInput {
  folderId: string;
  cardText: string | null;
  data: DataInput;
  now?: Date;
}

export interface ValidateAlertFileInput {
  /** File name, e.g. `deploy-failed.json` (also used for `.done/` files). */
  name: string;
  text: string;
  mtimeMs: number;
  now?: Date;
}

// --- helpers ---

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

function isValidId(v: string): boolean {
  if (!ID_PATTERN.test(v)) return false;
  if (v.endsWith('.')) return false;
  return !WINDOWS_RESERVED.test(v.split('.')[0]!);
}

/** Classify a directory entry name under feed/. Dot-prefixed -> ignore; `alerts` -> reserved. */
export function isCardFolderName(name: string): 'ignore' | 'reserved' | 'ok' | 'invalid' {
  if (typeof name !== 'string') return 'invalid';
  if (name.startsWith('.')) return 'ignore';
  if (name === 'alerts') return 'reserved';
  return isValidId(name) ? 'ok' : 'invalid';
}

function pointer(path: readonly PropertyKey[]): string {
  return path.map((p) => '/' + String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('');
}

function toIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[], prefix = ''): FolderIssue[] {
  return issues.map((i) => ({ path: prefix + pointer(i.path), message: i.message }));
}

function summarize(issues: FolderIssue[], what: string): string {
  const first = issues[0];
  if (!first) return `invalid ${what}`;
  const where = first.path === '' ? what : first.path;
  const more = issues.length > 1 ? ` (+${issues.length - 1} more)` : '';
  return `${where}: ${first.message}${more}`.replace(/\s*\n\s*/g, ' ');
}

function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1);
      if (n >= 0xdc00 && n <= 0xdfff) i++;
      else return true;
    } else if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}

type TextFail = { reason: Exclude<BrokenReason, 'schema-invalid' | 'unknown-type'>; message: string };

function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${n / (1024 * 1024)} MB` : `${n / 1024} KB`;
}

/** Text sanity -> parsed top-level object. Shared by card.json, data file and alert file. */
function parseObjectText(text: unknown, cap: number): { obj: Obj } | TextFail {
  if (typeof text !== 'string') return { reason: 'unreadable', message: 'file is not readable text' };
  if (text.includes('�') || hasLoneSurrogate(text)) {
    return { reason: 'unreadable', message: 'file is not valid UTF-8 text' };
  }
  // Each UTF-16 unit is at most 3 UTF-8 bytes; cheap pre-check before encoding.
  if (text.length > cap || new TextEncoder().encode(text).length > cap) {
    return { reason: 'too-large', message: `file is larger than ${formatBytes(cap)}` };
  }
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (src.trim() === '') return { reason: 'malformed-json', message: 'file is empty' };
  let raw: unknown;
  try {
    raw = JSON.parse(src);
  } catch (e) {
    return { reason: 'malformed-json', message: `invalid JSON: ${errorMessage(e)}`.replace(/\s*\n\s*/g, ' ') };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { reason: 'not-object', message: 'top-level JSON value must be an object' };
  }
  return { obj: raw as Obj };
}

function nowOf(now?: Date): number {
  return (now ?? realClock.now()).getTime();
}

function mtimeIso(mtimeMs: number, nowMs: number): string {
  const d = new Date(Number.isFinite(mtimeMs) ? mtimeMs : nowMs);
  return Number.isNaN(d.getTime()) ? new Date(nowMs).toISOString() : d.toISOString();
}

function skewWarning(updatedAt: string, source: UpdatedAtSource, nowMs: number, label: string): string[] {
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t) || t - nowMs <= CLOCK_SKEW_MS) return [];
  const mins = CLOCK_SKEW_MS / MS_PER_MINUTE;
  return [
    source === 'data'
      ? `${label}: updatedAt is more than ${mins} minutes in the future (clock skew?)`
      : `${label}: file mtime is more than ${mins} minutes in the future (clock skew?)`,
  ];
}

function strayIdWarning(obj: object, file: string, id: string): string[] {
  return hasStrayId(obj) ? [`${file}: "id" key is ignored; the name "${id}" is the id`] : [];
}

function skip(reason: SkipReason, message: string, issues: FolderIssue[] = [], id?: string): SkippedResult {
  return { status: 'skipped', reason, message, issues, ...(id !== undefined ? { id } : {}) };
}

// --- step 1 ---

/** Step 1: parse card.json so the caller learns the data file path. Never throws. */
export function parseCardDef(folderId: string, cardText: string | null): DefResult {
  try {
    return parseDef(folderId, cardText);
  } catch (e) {
    return skip('card-def-invalid', `could not process card.json: ${errorMessage(e)}`);
  }
}

function parseDef(folderId: string, cardText: string | null): DefResult {
  const kind = isCardFolderName(folderId);
  if (kind === 'reserved') return skip('reserved-id', `"${folderId}" is a reserved folder name`, [], folderId);
  if (kind !== 'ok') {
    return skip('invalid-id', `"${folderId}" is not a valid card id`, [{ path: '', message: 'invalid folder name' }]);
  }
  if (cardText === null) return skip('card-def-missing', 'card.json is missing', [], folderId);

  const parsed = parseObjectText(cardText, MAX_CARD_DEF_BYTES);
  if (!('obj' in parsed)) return skip('card-def-invalid', `card.json: ${parsed.message}`, [], folderId);

  const res = cardDefSchema.safeParse(parsed.obj);
  if (!res.success) {
    const issues = toIssues(res.error.issues);
    const reason: SkipReason = res.error.issues.some((i) => i.path[0] === 'data') ? 'data-path-invalid' : 'card-def-invalid';
    return skip(reason, `card.json ${summarize(issues, 'card.json')}`, issues, folderId);
  }
  return {
    status: 'ok',
    id: folderId,
    def: res.data,
    raw: parsed.obj,
    dataPath: res.data.data,
    warnings: strayIdWarning(parsed.obj, 'card.json', folderId),
  };
}

// --- step 2 ---

/** Validate a whole card folder (card.json + data file). Pure, never throws. */
export function validateCardFolder(i: ValidateCardFolderInput): FolderResult {
  try {
    return validateFolder(i);
  } catch (e) {
    return skip('card-def-invalid', `could not process card folder: ${errorMessage(e)}`, [], i.folderId);
  }
}

function broken(
  id: string,
  def: CardDef | undefined,
  reason: BrokenReason,
  message: string,
  issues: FolderIssue[] = [],
): BrokenResult {
  return { status: 'broken', reason, message, issues, id, ...(def ? { def } : {}) };
}

function validateFolder(i: ValidateCardFolderInput): FolderResult {
  const d = parseDef(i.folderId, i.cardText);
  if (d.status === 'skipped') return d;
  const { id, def } = d;
  const warnings = [...d.warnings];
  const nowMs = nowOf(i.now);

  if (!isRegisteredType(def.type)) {
    return broken(id, def, 'unknown-type', `unknown card type "${def.type}"`, [
      { path: '/type', message: 'unknown type' },
    ]);
  }
  const entry = registry[def.type];

  const base = {
    id,
    type: def.type,
    title: def.title,
    layout: def.layout,
    notify: def.notify,
    ...(def.show ? { show: def.show } : {}),
    ...(def.staleAfter !== undefined ? { staleAfter: def.staleAfter } : {}),
    def: d.raw,
  };

  if ('absent' in i.data) {
    // dataRequired(type) is always true today; a future per-type `dataOptional` flag would branch here.
    return { status: 'no-data', card: { ...base, priority: def.priority ?? 2 }, warnings };
  }
  if ('unreadable' in i.data) {
    return broken(id, def, 'unreadable', `data file: ${i.data.unreadable}`);
  }

  const dataFile = d.dataPath;
  const parsed = parseObjectText(i.data.text, MAX_CARD_BYTES);
  if (!('obj' in parsed)) return broken(id, def, parsed.reason, `${dataFile}: ${parsed.message}`);

  const df = dataFileSchema.safeParse(parsed.obj);
  if (!df.success) {
    const issues = toIssues(df.error.issues);
    return broken(id, def, 'schema-invalid', summarize(issues, dataFile), issues);
  }
  const content = df.data;
  warnings.push(...strayIdWarning(parsed.obj, dataFile, id));

  let payload: Obj | undefined;
  if (content.error === null) {
    const p = entry.schema.safeParse(content.data);
    if (!p.success) {
      const issues = toIssues(p.error.issues, '/data');
      return broken(id, def, 'schema-invalid', summarize(issues, dataFile), issues);
    }
    payload = p.data as Obj;
  }

  const source: UpdatedAtSource = content.updatedAt !== undefined ? 'data' : 'mtime';
  const updatedAt = content.updatedAt ?? mtimeIso(i.data.mtimeMs, nowMs);
  warnings.push(...skewWarning(updatedAt, source, nowMs, dataFile));

  return {
    status: 'ok',
    card: {
      ...base,
      priority: content.priority ?? def.priority ?? 2,
      updatedAt,
      updatedAtSource: source,
      error: content.error,
      ...(payload !== undefined ? { data: payload } : {}),
      content: parsed.obj,
    },
    warnings,
  };
}

// --- alerts ---

/** Validate an alert file (`feed/alerts/<id>.json` or `.done/<id>.json`). Never throws. */
export function validateAlertFile(i: ValidateAlertFileInput): AlertResult {
  const stem = typeof i.name === 'string' ? i.name.replace(/^.*[\\/]/, '').replace(/\.json$/i, '') : '';
  try {
    return validateAlert(i, stem);
  } catch (e) {
    return { status: 'broken', reason: 'unreadable', message: `could not process file: ${errorMessage(e)}`, issues: [], id: stem };
  }
}

function validateAlert(i: ValidateAlertFileInput, id: string): AlertResult {
  const fail = (
    reason: Exclude<BrokenReason, 'unknown-type'>,
    message: string,
    issues: FolderIssue[] = [],
  ): AlertResult => ({ status: 'broken', reason, message, issues, id });

  if (!isValidId(id) || !/\.json$/i.test(i.name)) {
    const issues = [{ path: '', message: 'alert file name must be <id>.json with a valid id' }];
    return fail('schema-invalid', `"${i.name}" is not a valid alert file name`, issues);
  }
  const parsed = parseObjectText(i.text, MAX_ALERT_BYTES);
  if (!('obj' in parsed)) return fail(parsed.reason, parsed.message);

  const res = alertSchema.safeParse(parsed.obj);
  if (!res.success) {
    const issues = toIssues(res.error.issues);
    return fail('schema-invalid', summarize(issues, 'alert'), issues);
  }
  const a = res.data;
  const nowMs = nowOf(i.now);
  const source: UpdatedAtSource = a.updatedAt !== undefined ? 'data' : 'mtime';
  const updatedAt = a.updatedAt ?? mtimeIso(i.mtimeMs, nowMs);
  const warnings = [...strayIdWarning(parsed.obj, i.name, id), ...skewWarning(updatedAt, source, nowMs, i.name)];
  return {
    status: 'ok',
    alert: {
      id,
      title: a.title,
      ...(a.text !== undefined ? { text: a.text } : {}),
      ...(a.link !== undefined ? { link: a.link } : {}),
      priority: a.priority,
      notify: a.notify,
      ...(a.show ? { show: a.show } : {}),
      updatedAt,
      updatedAtSource: source,
      raw: parsed.obj,
    },
    warnings,
  };
}
