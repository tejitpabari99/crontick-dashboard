import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { buildSchemas } from '../../scripts/schemas-build.js';
import { getExample, listTypes, registry, validateCardFile } from '../../src/index.js';

const root = join(import.meta.dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('templates', () => {
  it('has a registered type for every template file and vice versa', () => {
    const files = readdirSync(join(root, 'templates')).sort();
    expect(files).toEqual(listTypes().map((t) => `${t}.example.json`).sort());
  });

  for (const type of listTypes()) {
    it(`${type} example validates ok and matches its file`, () => {
      const text = read(`templates/${registry[type].example}`);
      const r = validateCardFile(text, { filename: `${JSON.parse(text).id}.json` });
      expect(r).toMatchObject({ ok: true });
      expect(JSON.parse(text).type).toBe(type);
      expect(getExample(type)).toEqual(JSON.parse(text));
    });

    it(`${type} has an example file name and UI component name`, () => {
      expect(registry[type].example).toBe(`${type}.example.json`);
      expect(registry[type].component).toMatch(/^[A-Z][A-Za-z0-9]*Card$/);
    });
  }

  it('getExample is undefined for unknown types', () => {
    expect(getExample('nope')).toBeUndefined();
  });

  it('demonstrates cell link next to row link, complete action, private extra', () => {
    const table = getExample('table') as { data: { rows: { link?: string; cells: unknown[] }[] } };
    expect(table.data.rows[0]!.link).toBeDefined();
    expect(table.data.rows[0]!.cells.some((c) => typeof c === 'object' && c !== null)).toBe(true);
    const list = getExample('list') as { data: { items: Record<string, unknown>[] } };
    expect(list.data.items.some((i) => i.action !== undefined && 'ticktick' in i)).toBe(true);
    const kpi = getExample('kpi') as { data: { items: unknown[] } };
    expect(kpi.data.items.length).toBeGreaterThan(1);
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
      const ex = getExample(type) as { data: unknown };
      expect(card(ex), `${type}: ${ajv.errorsText(card.errors)}`).toBe(true);
      expect(envelope(ex)).toBe(true);
      const perType = ajv.compile(JSON.parse(built[`${type}.json`]!));
      expect(perType(ex.data), `${type}: ${ajv.errorsText(perType.errors)}`).toBe(true);
    }
  });

  it('card.json rejects structurally wrong data and disallowed kinds', () => {
    const ajv = new Ajv2020({ strict: false });
    const card = ajv.compile(JSON.parse(built['card.json']!));
    const md = getExample('markdown') as Record<string, unknown>;
    expect(card({ ...md, data: { text: 5 } })).toBe(false);
    const table = getExample('table') as Record<string, unknown>;
    expect(card({ ...table, kind: 'alert' })).toBe(false);
    expect(card({ ...table, data: undefined, error: 'boom' })).toBe(true);
  });
});
