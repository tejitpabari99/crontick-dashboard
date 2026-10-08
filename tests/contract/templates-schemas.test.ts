import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { buildSchemas } from '../../scripts/schemas-build.js';
import { alertSchema } from '../../src/contract/alert.js';
import { cardDefSchema } from '../../src/contract/card-def.js';
import { dataFileSchema } from '../../src/contract/data-file.js';
import { dataRequired, getExample, listTypes, registry } from '../../src/index.js';
import { getLegacyExample, validateCardFile } from '../../src/feed/legacy-envelope.js';

const root = join(import.meta.dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('templates', () => {
  it('has a registered type for every template file and vice versa', () => {
    const files = readdirSync(join(root, 'templates')).filter((f) => f.endsWith('.example.json')).sort();
    expect(files).toEqual(listTypes().map((t) => `${t}.example.json`).sort());
  });

  for (const type of listTypes()) {
    it(`${type} example validates ok and matches its file`, () => {
      const text = read(`templates/${type}.example.json`);
      const r = validateCardFile(text, { filename: `${JSON.parse(text).id}.json` });
      expect(r).toMatchObject({ ok: true });
      expect(JSON.parse(text).type).toBe(type);
      expect(getLegacyExample(type)).toEqual(JSON.parse(text));
    });

    it(`${type} has an example file name and a summary`, () => {
      expect(typeof registry[type]).toBe('object');
      expect(typeof registry[type].summary).toBe('function');
    });
  }

  it('getLegacyExample is undefined for unknown types', () => {
    expect(getLegacyExample('nope')).toBeUndefined();
  });

  it('demonstrates cell link next to row link, complete action, private extra', () => {
    const table = getLegacyExample('table') as { data: { rows: { link?: string; cells: unknown[] }[] } };
    expect(table.data.rows[0]!.link).toBeDefined();
    expect(table.data.rows[0]!.cells.some((c) => typeof c === 'object' && c !== null)).toBe(true);
    const list = getLegacyExample('list') as { data: { items: Record<string, unknown>[] } };
    expect(list.data.items.some((i) => i.action !== undefined && 'ticktick' in i)).toBe(true);
    const kpi = getLegacyExample('kpi') as { data: { items: unknown[] } };
    expect(kpi.data.items.length).toBeGreaterThan(1);
  });
});

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

  it('covers envelope, card and one per type', () => {
    expect(Object.keys(built).sort()).toEqual(
      ['card.json', 'envelope.json', ...listTypes().map((t) => `${t}.json`)].sort(),
    );
  });

  it('committed schemas/ match regeneration (stale = fail; run npm run gen:schemas)', () => {
    for (const [name, content] of Object.entries(built)) {
      expect(read(`schemas/${name}`), name).toBe(content);
    }
    expect(readdirSync(join(root, 'schemas')).sort()).toEqual(Object.keys(built).sort());
  });

  it('a stock JSON Schema validator accepts all examples against card.json and per-type schemas', () => {
    const ajv = new Ajv2020({ strict: false });
    const card = ajv.compile(JSON.parse(built['card.json']!));
    const envelope = ajv.compile(JSON.parse(built['envelope.json']!));
    for (const type of listTypes()) {
      const ex = getLegacyExample(type) as { data: unknown };
      expect(card(ex), `${type}: ${ajv.errorsText(card.errors)}`).toBe(true);
      expect(envelope(ex)).toBe(true);
      const perType = ajv.compile(JSON.parse(built[`${type}.json`]!));
      expect(perType(ex.data), `${type}: ${ajv.errorsText(perType.errors)}`).toBe(true);
    }
  });

  it('card.json rejects structurally wrong data and disallowed kinds', () => {
    const ajv = new Ajv2020({ strict: false });
    const card = ajv.compile(JSON.parse(built['card.json']!));
    const md = getLegacyExample('markdown') as Record<string, unknown>;
    expect(card({ ...md, data: { text: 5 } })).toBe(false);
    const table = getLegacyExample('table') as Record<string, unknown>;
    expect(card({ ...table, kind: 'alert' })).toBe(false);
    expect(card({ ...table, data: undefined, error: 'boom' })).toBe(true);
  });
});
