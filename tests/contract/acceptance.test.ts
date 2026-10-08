import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listTypes, validateAlertFile, validateCardFolder } from '../../src/index.js';

const root = join(import.meta.dirname, '..', '..');
const NOW = new Date('2026-10-05T10:00:00Z');
const MT = Date.parse('2026-10-05T09:00:00Z');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('SP01 acceptance: templates validate ok through the validators', () => {
  for (const type of listTypes()) {
    it(`${type} folder template -> ok`, () => {
      const r = validateCardFolder({
        folderId: `${type}-demo`,
        cardText: read(`templates/${type}/card.json`),
        data: { text: read(`templates/${type}/data.json`), mtimeMs: MT },
        now: NOW,
      });
      expect(r.status, JSON.stringify(r)).toBe('ok');
    });
  }
  it('alert template -> ok', () => {
    const r = validateAlertFile({ name: 'alert.json', text: read('templates/alert/alert.json'), mtimeMs: MT, now: NOW });
    expect(r.status, JSON.stringify(r)).toBe('ok');
  });
});

describe('SP01 acceptance: removed symbols are gone from src/contract', () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(join(root, 'src/contract'));
  it('no envelope.ts file', () => {
    expect(existsSync(join(root, 'src/contract/envelope.ts'))).toBe(false);
  });
  it.each(['validateCardFile', 'envelope', 'id-mismatch', 'allowedKinds'])('no reference to %s', (sym) => {
    for (const f of files) expect(readFileSync(f, 'utf8'), `${f}: ${sym}`).not.toContain(sym);
  });
  it('no node: imports', () => {
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/['"]node:/);
  });
});
