import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { buildSchemas } from '../../scripts/schemas-build.js';
import { alertSchema } from '../../src/contract/alert.js';
import { cardDefSchema } from '../../src/contract/card-def.js';
import { dataFileSchema } from '../../src/contract/data-file.js';
import { dataRequired, getExample, listTypes, registry } from '../../src/index.js';

const root = join(import.meta.dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('folder templates', () => {
  const json = (p: string) => JSON.parse(read(p)) as Record<string, unknown>;

  it('has a folder per registered type plus alert, matching the registry', () => {
    const dirs = readdirSync(join(root, 'templates'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(dirs.sort()).toEqual([...listTypes(), 'alert'].sort());
  });

  for (const type of listTypes()) {
    it(`${type} template parses against card-def, data-file and the payload schema`, () => {
      const ex = getExample(type)!;
      expect(ex.card).toEqual(json(`templates/${type}/card.json`));
      expect(ex.data).toEqual(json(`templates/${type}/data.json`));
      expect(ex.card.$schema).toBe('../../schemas/card-def.json');
      expect(ex.data.$schema).toBe(`../../schemas/data.${type}.json`);
      const card = cardDefSchema.parse(ex.card);
      expect(card.type).toBe(type);
      expect(card.data).toBe('data.json');
      const data = dataFileSchema.parse(ex.data);
      expect(registry[type].schema.safeParse(data.data).success).toBe(true);
    });
  }

  it('alert template parses against the alert schema', () => {
    const a = json('templates/alert/alert.json');
    expect(a.$schema).toBe('../../schemas/alert.json');
    expect(alertSchema.safeParse(a).success).toBe(true);
  });

  it('getExample returns a fresh copy; undefined for unknown types', () => {
    expect(getExample('nope')).toBeUndefined();
    const a = getExample('kpi')!;
    a.card.title = 'x';
    expect(getExample('kpi')!.card.title).not.toBe('x');
  });

  it('dataRequired is true for every type', () => {
    for (const t of listTypes()) expect(dataRequired(t)).toBe(true);
  });
});

describe('generated JSON Schemas', () => {
  const built = buildSchemas();
  const expected = [
    'alert.json',
    'card-def.json',
    'data.json',
    ...listTypes().map((t) => `data.${t}.json`),
    ...listTypes().map((t) => `${t}.json`),
  ].sort();

  it('covers card-def, data, alert, data.<type> and one payload per type', () => {
    expect(Object.keys(built).sort()).toEqual(expected);
  });

  it('committed schemas/ match regeneration (stale = fail; run npm run gen:schemas)', () => {
    for (const [name, content] of Object.entries(built)) {
      expect(read(`schemas/${name}`), name).toBe(content);
    }
    expect(readdirSync(join(root, 'schemas')).sort()).toEqual(expected);
  });

  it('a stock JSON Schema validator accepts all folder templates', () => {
    const ajv = new Ajv2020({ strict: false });
    const cardDef = ajv.compile(JSON.parse(built['card-def.json']!));
    const generic = ajv.compile(JSON.parse(built['data.json']!));
    for (const type of listTypes()) {
      const ex = getExample(type)!;
      expect(cardDef(ex.card), `${type} card: ${ajv.errorsText(cardDef.errors)}`).toBe(true);
      expect(generic(ex.data), `${type} generic: ${ajv.errorsText(generic.errors)}`).toBe(true);
      const typed = ajv.compile(JSON.parse(built[`data.${type}.json`]!));
      expect(typed(ex.data), `${type} data: ${ajv.errorsText(typed.errors)}`).toBe(true);
      const payload = ajv.compile(JSON.parse(built[`${type}.json`]!));
      expect(payload(ex.data.data), `${type} payload: ${ajv.errorsText(payload.errors)}`).toBe(true);
    }
    const alert = ajv.compile(JSON.parse(built['alert.json']!));
    expect(alert(JSON.parse(read('templates/alert/alert.json')))).toBe(true);
  });

  it('rejects unregistered types and structurally wrong typed data; error cards skip payload', () => {
    const ajv = new Ajv2020({ strict: false });
    const cardDef = ajv.compile(JSON.parse(built['card-def.json']!));
    expect(cardDef({ ...getExample('table')!.card, type: 'nope' })).toBe(false);
    const md = ajv.compile(JSON.parse(built['data.markdown.json']!));
    expect(md({ data: { text: 5 } })).toBe(false);
    expect(md({ error: 'boom' })).toBe(true);
    expect(md({})).toBe(false);
  });
});
