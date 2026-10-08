// TEMPORARY: v0.1.0 envelope kept only until SP02/SP04 rewrite ingest/CLI; delete then.
// Not exported from src/index.ts. Moved verbatim from src/contract/{envelope,validate,registry}.ts.
import { z } from 'zod';
import { realClock } from '../clock.js';
import { CLOCK_SKEW_MS, ID_PATTERN, MAX_CARD_BYTES } from '../constants/contract.js';
import { MS_PER_MINUTE } from '../constants/time.js';
import { cronSchema, durationSchema, timestampSchema } from '../contract/formats.js';
import { isRegisteredType, registry, type RegisteredType } from '../contract/registry.js';
import { errorMessage } from '../utils/errors.js';
import kpiExample from '../../templates/kpi.example.json' with { type: 'json' };
import listExample from '../../templates/list.example.json' with { type: 'json' };
import markdownExample from '../../templates/markdown.example.json' with { type: 'json' };
import mediaExample from '../../templates/media.example.json' with { type: 'json' };
import tableExample from '../../templates/table.example.json' with { type: 'json' };

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

function isValidId(v: string): boolean {
  if (!ID_PATTERN.test(v)) return false;
  if (v.endsWith('.')) return false;
  // Windows reserves the name before the first dot, with or without extension.
  return !WINDOWS_RESERVED.test(v.split('.')[0]!);
}

export const idSchema = z.string().refine(isValidId, {
  message:
    `id must match ${ID_PATTERN.source}, not end with ".", and not be a Windows reserved name (con, prn, aux, nul, com1-9, lpt1-9)`,
});

export const showSchema = z.looseObject({
  cron: cronSchema,
  for: durationSchema.optional(),
});

/**
 * Card envelope. Unknown keys are preserved untouched everywhere (C2).
 * Keys starting with `x-` are reserved: the contract will never use them, agents may.
 */
export const envelopeSchema = z
  .looseObject({
    id: idSchema,
    kind: z.enum(['panel', 'alert']),
    type: z.string(),
    title: z.string().min(1).max(200),
    updatedAt: timestampSchema,
    priority: z.number().int().min(0).max(5).default(2),
    notify: z.boolean().default(false),
    show: showSchema.optional(),
    staleAfter: durationSchema.optional(),
    retention: durationSchema.optional(),
    size: z.enum(['S', 'M', 'L']).default('M'),
    error: z
      .string()
      .nullable()
      .transform((v) => (v === '' ? null : v))
      .default(null),
    data: z.looseObject({}).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.data === undefined && v.error === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['data'],
        message: 'data is required unless error is set to a non-empty string',
      });
    }
  });

export type Envelope = z.infer<typeof envelopeSchema>;
export type EnvelopeInput = z.input<typeof envelopeSchema>;
export type Show = z.infer<typeof showSchema>;

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
  if (!legacyAllowedKinds(card.type).includes(card.kind)) {
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

// --- Legacy example/kind helpers (single-file envelope era). ---
const LEGACY_EXAMPLES = {
  markdown: markdownExample,
  table: tableExample,
  list: listExample,
  kpi: kpiExample,
  media: mediaExample,
} as const satisfies Record<RegisteredType, unknown>;
const LEGACY_KINDS = {
  markdown: ['panel', 'alert'],
  table: ['panel'],
  list: ['panel', 'alert'],
  kpi: ['panel', 'alert'],
  media: ['panel'],
} as const satisfies Record<RegisteredType, readonly string[]>;

export function getLegacyExample(type: string): unknown {
  return isRegisteredType(type) ? structuredClone(LEGACY_EXAMPLES[type]) : undefined;
}
export function getExampleFile(type: string): string | undefined {
  return isRegisteredType(type) ? `${type}.example.json` : undefined;
}
export function legacyAllowedKinds(type: RegisteredType): readonly string[] {
  return LEGACY_KINDS[type];
}
