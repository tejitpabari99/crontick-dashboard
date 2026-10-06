import { realClock } from '../clock.js';
import { CLOCK_SKEW_MS, ID_PATTERN, MAX_CARD_BYTES } from '../constants/contract.js';
import { MS_PER_MINUTE } from '../constants/time.js';
import { errorMessage } from '../utils/errors.js';
import { envelopeSchema, type Envelope } from './envelope.js';
import { isRegisteredType, registry } from './registry.js';

export type Card = Omit<Envelope, 'data'> & { data?: Record<string, unknown> };

export type BrokenReason =
  | 'unreadable'
  | 'malformed-json'
  | 'not-object'
  | 'too-large'
  | 'schema-invalid'
  | 'unknown-type'
  | 'id-mismatch';

export interface Issue {
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; card: Card; warnings: string[] }
  | { broken: true; reason: BrokenReason; message: string; issues: Issue[]; id?: string };


function pointer(path: readonly PropertyKey[]): string {
  return path.map((p) => '/' + String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('');
}

function toIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[]): Issue[] {
  return issues.map((i) => ({ path: pointer(i.path), message: i.message }));
}

function summarize(issues: Issue[]): string {
  const first = issues[0];
  if (!first) return 'invalid card';
  const where = first.path === '' ? 'card' : first.path;
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

function fail(reason: BrokenReason, message: string, issues: Issue[] = [], id?: string): ValidationResult {
  return { broken: true, reason, message, issues, ...(id !== undefined ? { id } : {}) };
}

/** Never throws. The only validation entry point. */
export interface ValidateOptions {
  /** File name the card was read from; its stem must equal the card id. */
  filename?: string;
  /** Current time for the future-`updatedAt` skew warning (default: now). */
  now?: Date;
}

export function validateCardFile(text: string, opts?: ValidateOptions): ValidationResult {
  try {
    return validate(text, opts);
  } catch (e) {
    return fail('unreadable', `could not process file: ${errorMessage(e)}`);
  }
}

function validate(text: string, opts?: ValidateOptions): ValidationResult {
  if (typeof text !== 'string') return fail('unreadable', 'file is not readable text');
  if (text.includes('�') || hasLoneSurrogate(text)) {
    return fail('unreadable', 'file is not valid UTF-8 text');
  }
  // Each UTF-16 unit is at most 3 UTF-8 bytes; cheap pre-check before encoding.
  if (text.length > MAX_CARD_BYTES || new TextEncoder().encode(text).length > MAX_CARD_BYTES) {
    return fail('too-large', `file is larger than ${MAX_CARD_BYTES / (1024 * 1024)} MB`);
  }
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (src.trim() === '') return fail('malformed-json', 'file is empty');

  let raw: unknown;
  try {
    raw = JSON.parse(src);
  } catch (e) {
    return fail('malformed-json', `invalid JSON: ${errorMessage(e)}`.replace(/\s*\n\s*/g, ' '));
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('not-object', 'top-level JSON value must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const rawId = typeof obj.id === 'string' && ID_PATTERN.test(obj.id) ? obj.id : undefined;

  const env = envelopeSchema.safeParse(obj);
  if (!env.success) {
    const issues = toIssues(env.error.issues);
    return fail('schema-invalid', summarize(issues), issues, rawId);
  }
  const card = env.data;

  if (!isRegisteredType(card.type)) {
    return fail('unknown-type', `unknown card type "${card.type}"`, [{ path: '/type', message: 'unknown type' }], card.id);
  }
  if (opts?.filename !== undefined) {
    const stem = opts.filename.replace(/^.*[\\/]/, '').replace(/\.json$/i, '');
    if (stem !== card.id) {
      return fail('id-mismatch', `id "${card.id}" does not match filename "${opts.filename}"`, [
        { path: '/id', message: `must equal filename stem "${stem}"` },
      ], card.id);
    }
  }
  const entry = registry[card.type];
  if (!(entry.allowedKinds as readonly string[]).includes(card.kind)) {
    const issues = [{ path: '/type', message: `type "${card.type}" is not allowed on kind "${card.kind}"` }];
    return fail('schema-invalid', summarize(issues), issues, card.id);
  }

  // An agent-declared error card (C7) is ok; its data is not validated.
  if (card.error === null && card.data !== undefined) {
    const d = entry.schema.safeParse(card.data);
    if (!d.success) {
      const issues = toIssues(d.error.issues).map((i) => ({ ...i, path: '/data' + i.path }));
      return fail('schema-invalid', summarize(issues), issues, card.id);
    }
    card.data = d.data as Record<string, unknown>;
  }

  const warnings: string[] = [];
  const t = Date.parse(card.updatedAt);
  if (!Number.isNaN(t) && t - (opts?.now ?? realClock.now()).getTime() > CLOCK_SKEW_MS) {
    warnings.push(`updatedAt is more than ${CLOCK_SKEW_MS / MS_PER_MINUTE} minutes in the future (clock skew?)`);
  }
  return { ok: true, card: card as Card, warnings };
}
