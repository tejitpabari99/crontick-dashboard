import { z } from 'zod';
import { alertSchema } from '../src/contract/alert.js';
import { cardDefSchema } from '../src/contract/card-def.js';
import { dataFileSchema } from '../src/contract/data-file.js';
import { registry, listTypes, type RegisteredType } from '../src/contract/registry.js';

type Json = Record<string, unknown>;

/** Rules Zod expresses with refine/transform, which JSON Schema output cannot represent. */
const LOSSY_NOTES: Record<string, string> = {
  'card-def':
    'Not expressible in JSON Schema, enforced by the validator: the card id comes from the folder name (^[a-z0-9][a-z0-9._-]{0,63}$, no trailing ".", no Windows reserved names), never from the file; a stray "id" key is ignored with a warning; type must be a registered card type; "data" is a plain file name inside the card folder (1-100 chars, ends with .json, no "/", no backslash or control chars, not leading ".", not card.json) and defaults to data.json; show.cron must be a valid 5-field cron (no aliases, no seconds); durations (staleAfter, show.for) match ^[1-9]\\d*(m|h|d|w)$, max 3650d; defaults are applied by the validator (data "data.json", layout {column:"center",order:0,height:"auto"}, notify false). Unknown keys are preserved; keys starting with "x-" are reserved for agents.',
  data:
    'Not expressible in JSON Schema, enforced by the validator: data must be an object unless error is a non-empty string; error "" is treated as null (default null); updatedAt must be an RFC 3339 timestamp with offset or Z. When error is set the payload is not validated. The generic data.json leaves the payload open; the validator applies the per-type payload schema chosen by the card type.',
  alert:
    'Not expressible in JSON Schema, enforced by the validator: the alert id is the file name stem (feed/alerts/<id>.json), same id rules as card folders; text must be a single line (max 200 chars); link must be http, https, mailto or ms-outlook (max 2048 chars, no whitespace); show.cron must be a valid 5-field cron; durations match ^[1-9]\\d*(m|h|d|w)$; updatedAt must be an RFC 3339 timestamp; defaults applied by the validator (priority 2, notify false).',
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
  const types = listTypes() as RegisteredType[];

  const cardDef = convert(cardDefSchema, LOSSY_NOTES['card-def']!, 'crontick card definition (card.json)');
  const cardProps = cardDef.properties as Json;
  cardProps.type = { type: 'string', enum: types };
  out['card-def.json'] = stable(cardDef);

  const dataFile = convert(dataFileSchema, LOSSY_NOTES.data!, 'crontick card data file');
  out['data.json'] = stable(dataFile);

  out['alert.json'] = stable(convert(alertSchema, LOSSY_NOTES.alert!, 'crontick alert'));

  for (const type of types) {
    const payload = convert(registry[type].schema, LOSSY_NOTES[type]!, `crontick ${type} card data`);
    out[`${type}.json`] = stable(payload);

    const { $schema: _omit, ...def } = payload;
    void _omit;
    const typed: Json = JSON.parse(JSON.stringify(dataFile));
    typed.title = `crontick ${type} card data file`;
    typed.description = `Data file (data.json) for a ${type} card: the data key is bound to the ${type} payload. ${LOSSY_NOTES.data}`;
    const props = typed.properties as Json;
    props.data = def;
    typed.allOf = [
      { if: { properties: { error: { enum: [null, ''] } } }, then: { required: ['data'] } },
    ];
    out[`data.${type}.json`] = stable(typed);
  }
  return out;
}
