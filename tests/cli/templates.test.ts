import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { run, type CliIo } from '../../src/cli/main.js';
import { getExample, listTypes } from '../../src/contract/index.js';
import { packageAssets } from '../../src/cli/assets.js';

interface Cap {
  io: CliIo;
  out: string;
  err: string;
}
function cap(stdin = ''): Cap {
  const c: Cap = { out: '', err: '', io: undefined as unknown as CliIo };
  c.io = {
    stdout: (s) => void (c.out += s),
    stderr: (s) => void (c.err += s),
    readStdin: async () => stdin,
    env: {},
    isTTY: false,
  };
  return c;
}
const { schemasDir, templatesDir } = packageAssets();
const all = [...listTypes(), 'alert'];

describe('templates', () => {
  it('no arg lists types + alert with SUMMARY and FOLDER, no KINDS', async () => {
    const c = cap();
    expect(await run(['templates'], c.io)).toBe(0);
    const lines = c.out.trim().split('\n');
    expect(lines[0]).toMatch(/^TYPE\s+SUMMARY\s+FOLDER$/);
    expect(lines[0]).not.toContain('KINDS');
    const rows = lines.slice(1);
    expect(rows.map((l) => l.trim().split(/\s+/)[0])).toEqual(all);
    for (const t of all) expect(rows.find((l) => l.startsWith(`${t} `))).toContain(join(templatesDir, t));
  });

  it('<type> prints card.json and data.json blocks equal to the embedded example', async () => {
    for (const t of listTypes()) {
      const c = cap();
      expect(await run(['templates', t], c.io)).toBe(0);
      const m = /^# card\.json\n([\s\S]*)\n# data\.json\n([\s\S]*)$/.exec(c.out);
      expect(m, t).not.toBeNull();
      const ex = getExample(t)!;
      expect(JSON.parse(m![1]!)).toEqual(ex.card);
      expect(JSON.parse(m![2]!)).toEqual(ex.data);
    }
  });

  it('alert prints one block', async () => {
    const c = cap();
    expect(await run(['templates', 'alert'], c.io)).toBe(0);
    expect(c.out.startsWith('# alert.json\n')).toBe(true);
    expect(c.out).not.toContain('# card.json');
    expect(JSON.parse(c.out.replace(/^# alert\.json\n/, ''))).toEqual(
      JSON.parse(readFileSync(join(templatesDir, 'alert', 'alert.json'), 'utf8')),
    );
  });

  it('--file prints one raw file equal to getExample', async () => {
    for (const t of listTypes()) {
      for (const f of ['card', 'data'] as const) {
        const c = cap();
        expect(await run(['templates', t, '--file', f], c.io)).toBe(0);
        expect(JSON.parse(c.out)).toEqual(getExample(t)![f]);
      }
    }
    const c = cap();
    expect(await run(['templates', 'table', '--file', 'nope'], c.io)).toBe(2);
  });

  it('--schema defaults to data, supports card and payload, alert uses alert.json', async () => {
    const read = (f: string) => readFileSync(join(schemasDir, f), 'utf8');
    for (const t of listTypes()) {
      for (const [flag, file] of [[[], `data.${t}.json`], [['card'], 'card-def.json'], [['payload'], `${t}.json`]] as const) {
        const c = cap();
        expect(await run(['templates', t, '--schema', ...flag], c.io)).toBe(0);
        expect(c.out).toBe(read(file));
        expect(() => new Ajv2020({ strict: false }).compile(JSON.parse(c.out) as object)).not.toThrow();
      }
    }
    for (const flag of [[], ['payload']]) {
      const c = cap();
      expect(await run(['templates', 'alert', '--schema', ...flag], c.io)).toBe(0);
      expect(c.out).toBe(read('alert.json'));
    }
    const bad = cap();
    expect(await run(['templates', 'table', '--schema', 'zzz'], bad.io)).toBe(2);
  });

  it('--path prints folder and existing schema paths', async () => {
    const c = cap();
    expect(await run(['templates', 'table', '--path'], c.io)).toBe(0);
    const paths = c.out.trim().split('\n');
    expect(paths[0]).toBe(join(templatesDir, 'table'));
    expect(paths.length).toBe(4);
    for (const p of paths) expect(existsSync(p), p).toBe(true);
  });

  it('--verbose prints the error code', async () => {
    const c = cap();
    expect(await run(['--verbose', 'templates', 'nope'], c.io)).toBe(2);
    expect(c.err).toContain('code: UNKNOWN_TYPE');
  });

  it('unknown type exits 2 listing valid types', async () => {
    const c = cap();
    expect(await run(['templates', 'nope'], c.io)).toBe(2);
    expect(c.out).toBe('');
    for (const t of all) expect(c.err).toContain(t);
  });
});
