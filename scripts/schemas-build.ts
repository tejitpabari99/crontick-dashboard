import { z } from 'zod';
import { envelopeSchema } from '../src/contract/envelope.js';
import { registry, listTypes, legacyAllowedKinds, type RegisteredType } from '../src/contract/registry.js';

type Json = Record<string, unknown>;

/** Rules Zod expresses with refine/transform, which JSON Schema output cannot represent. */
const LOSSY_NOTES: Record<string, string> = {
  envelope:
    'Not expressible in JSON Schema, enforced by the validator: id pattern ^[a-z0-9][a-z0-9._-]{0,63}$ (no trailing ".", no Windows reserved names); updatedAt must be an RFC 3339 timestamp with offset or Z; show.cron must be a valid 5-field cron (no aliases, no seconds); durations (staleAfter, retention, show.for) match ^[1-9]\\d*(m|h|d|w)$, max 3650d; data is required unless error is a non-empty string; error "" is treated as null; priority/notify/size/error defaults are applied by the validator. Unknown keys are preserved; keys starting with "x-" are reserved for agents.',
  markdown: 'Not expressible in JSON Schema: none beyond the text length limit.',
  table:
    'Not expressible in JSON Schema, enforced by the validator: every row must have exactly as many cells as columns; defaultSort.column must be within range; link values must be http, https, mailto or ms-outlook (max 2048 chars, no whitespace).',
  list:
    'Not expressible in JSON Schema, enforced by the validator: item ids must be unique; an item with action requires id; due is YYYY-MM-DD or an RFC 3339 datetime; checkedAt is an RFC 3339 timestamp; link values must be http, https, mailto or ms-outlook. A bare string action ("complete") is accepted as shorthand for {"type":"complete"}.',
  kpi:
    'Not expressible in JSON Schema, enforced by the validator: data must use either "items" or the flat single-metric form (value, label, unit, state, trend, link at the top level), not both; the flat form is normalized to items of length 1. This schema describes the canonical "items" form only; link values must be http, https, mailto or ms-outlook.',
  media:
    'Not expressible in JSON Schema, enforced by the validator: src must be an http(s) URL or a data:image/* URI; link values must be http, https, mailto or ms-outlook.',
};

/** z.preprocess hides the bare-string action shorthand from the input schema; add it back. */
function allowActionShorthand(node: unknown): void {
  if (Array.isArray(node)) return node.forEach(allowActionShorthand);
  if (node === null || typeof node !== 'object') return;
  const obj = node as Json;
  const props = obj.properties as Json | undefined;
  if (props && 'action' in props && (props.action as Json).type === 'object') {
    props.action = { anyOf: [{ type: 'string', enum: ['dismiss', 'complete'] }, props.action] };
  }
  Object.values(obj).forEach(allowActionShorthand);
}

function convert(schema: z.ZodType, note: string, title: string): Json {
  const js = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Json;
  allowActionShorthand(js);
  const { $schema, ...rest } = js;
  return { $schema, title, description: note, ...rest };
}

function stable(v: unknown): string {
  return JSON.stringify(v, null, 2) + '\n';
}

/** Build every schemas/*.json file in memory: { "<file name>": "<contents>" }. */
export function buildSchemas(): Record<string, string> {
  const out: Record<string, string> = {};
  const envelope = convert(envelopeSchema, LOSSY_NOTES.envelope!, 'crontick card envelope');
  out['envelope.json'] = stable(envelope);

  const defs: Record<string, Json> = {};
  const allOf: Json[] = [];
  for (const type of listTypes() as RegisteredType[]) {
    const entry = registry[type];
    const s = convert(entry.schema, LOSSY_NOTES[type]!, `crontick ${type} card data`);
    out[`${type}.json`] = stable(s);
    const { $schema: _omit, ...def } = s;
    void _omit;
    defs[type] = def;
    allOf.push({
      if: {
        properties: { type: { const: type }, error: { enum: [null, ''] } },
        required: ['type'],
      },
      then: {
        properties: { kind: { enum: [...legacyAllowedKinds(type)] }, data: { $ref: `#/$defs/${type}` } },
      },
    });
  }

  const { $schema, ...envRest } = envelope;
  const card: Json = {
    $schema,
    ...envRest,
    title: 'crontick card',
    description:
      'Full card: the envelope plus per-type data (selected by "type") and the allowed kinds per type. Per-type data is only checked when error is absent/null/empty (an agent-declared error card skips data validation). ' +
      'Unknown types are rejected by the validator, not by this schema. ' +
      LOSSY_NOTES.envelope,
    allOf,
    $defs: defs,
  };
  out['card.json'] = stable(card);
  return out;
}
