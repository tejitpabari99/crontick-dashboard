import { existsSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { run, type CliIo } from '../../src/cli/main.js';
import { legacyAllowedKinds, listTypes } from '../../src/contract/index.js';

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

describe('templates', () => {
  it('no arg lists exactly the registered types with kinds and example path', async () => {
    const c = cap();
    expect(await run(['templates'], c.io)).toBe(0);
    const lines = c.out.trim().split('\n');
    const rows = lines.slice(1);
    expect(rows.map((l) => l.trim().split(/\s+/)[0])).toEqual(listTypes());
    for (const t of listTypes()) {
      const row = rows.find((l) => l.trim().startsWith(`${t} `))!;
      expect(row).toContain(legacyAllowedKinds(t).join(','));
      expect(row).toContain(`${t}.example.json`);
    }
  });

  it('templates kpi output passes validate -', async () => {
    const c = cap();
    expect(await run(['templates', 'kpi'], c.io)).toBe(0);
    const v = cap(c.out);
    expect(await run(['validate', '-'], v.io)).toBe(0);
    expect(v.out).toMatch(/^OK /);
  });

  it('--schema prints JSON that compiles with ajv', async () => {
    for (const t of listTypes()) {
      const c = cap();
      expect(await run(['templates', t, '--schema'], c.io)).toBe(0);
      const schema = JSON.parse(c.out) as object;
      expect(() => new Ajv2020({ strict: false }).compile(schema)).not.toThrow();
    }
  });

  it('--path prints existing file paths', async () => {
    const c = cap();
    expect(await run(['templates', 'table', '--path'], c.io)).toBe(0);
    const paths = c.out.trim().split('\n');
    expect(paths.length).toBe(2);
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
    for (const t of listTypes()) expect(c.err).toContain(t);
  });
});
