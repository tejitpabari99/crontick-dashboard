import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run, type CliIo } from '../../src/cli/main.js';
import { checkNodeVersion, guardedMain } from '../../src/cli/guard.js';
import { validateCardFile } from '../../src/index.js';
import { ENV_HOME, ENV_VERBOSE } from '../../src/constants/env.js';

const root = join(import.meta.dirname, '..', '..');
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cd-validate-'));
});
/** Copy a shipped template to `<dir>/<id>.json` so the filename-stem check passes. */
const tpl = (n: string): string => {
  const text = readFileSync(join(root, 'templates', `${n}.example.json`), 'utf8');
  const id = (JSON.parse(text) as { id: string }).id;
  const p = join(dir, `${id}.json`);
  writeFileSync(p, text);
  return p;
};
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface Cap {
  io: CliIo;
  out: string;
  err: string;
}
function cap(stdin = '', env: Record<string, string | undefined> = {}): Cap {
  const c: Cap = { out: '', err: '', io: undefined as unknown as CliIo };
  c.io = {
    stdout: (s) => void (c.out += s),
    stderr: (s) => void (c.err += s),
    readStdin: async () => stdin,
    env,
    isTTY: false,
  };
  return c;
}
const write = (name: string, text: string): string => {
  const p = join(dir, name);
  writeFileSync(p, text);
  return p;
};
const good = readFileSync(join(root, 'templates', 'kpi.example.json'), 'utf8');

describe('validate', () => {
  it('exit 0 when all ok, prints OK lines', async () => {
    const c = cap();
    const code = await run(['validate', tpl('kpi'), tpl('table')], c.io);
    expect(code).toBe(0);
    expect(c.out).toMatch(/^OK /m);
    expect(c.out).not.toMatch(/BROKEN/);
  });

  it('exit 1 for truncated JSON with reason', async () => {
    const f = write('x.json', good.slice(0, 40));
    const c = cap();
    expect(await run(['validate', f], c.io)).toBe(1);
    expect(c.out).toMatch(/^BROKEN malformed-json: /m);
  });

  it('exit 1 for bad id with issue lines', async () => {
    const card = JSON.parse(good) as Record<string, unknown>;
    card.id = 'Bad ID!';
    const f = write('Bad ID!.json', JSON.stringify(card));
    const c = cap();
    expect(await run(['validate', f], c.io)).toBe(1);
    expect(c.out).toMatch(/^BROKEN /m);
    expect(c.out).toMatch(/^ {2}\/id: /m);
  });

  it('exit 1 for javascript: link', async () => {
    const card = JSON.parse(good) as Record<string, unknown>;
    card.id = 'js-link';
    (card.data as { items: { link?: string }[] }).items[0]!.link = 'javascript:alert(1)';
    const f = write('js-link.json', JSON.stringify(card));
    const c = cap();
    expect(await run(['validate', f], c.io)).toBe(1);
    expect(c.out).toMatch(/^BROKEN /m);
  });

  it('any broken among several -> 1, ok ones still reported', async () => {
    const bad = write('bad.json', '{');
    const c = cap();
    expect(await run(['validate', tpl('kpi'), bad], c.io)).toBe(1);
    expect(c.out).toMatch(/^OK /m);
    expect(c.out).toMatch(/^BROKEN /m);
  });

  it('missing file -> 2, single stderr line', async () => {
    const c = cap();
    const code = await run(['validate', join(dir, 'nope.json')], c.io);
    expect(code).toBe(2);
    expect(c.err.trim().split('\n')).toHaveLength(1);
    expect(c.err).toMatch(/nope\.json/);
    expect(c.err).not.toMatch(/\n\s+at /);
  });

  it('no file args -> 2 usage error', async () => {
    const c = cap();
    expect(await run(['validate'], c.io)).toBe(2);
    expect(c.err).toMatch(/error/i);
  });

  it('stdin via "-" skips filename check', async () => {
    const card = JSON.parse(good) as { id: string };
    const c = cap(JSON.stringify({ ...card, id: 'whatever-id' }));
    expect(await run(['validate', '-'], c.io)).toBe(0);
    expect(c.out).toMatch(/^OK whatever-id /m);
  });

  it('--json prints [{file,result}] equal to validateCardFile', async () => {
    const bad = write('bad.json', '{"id":');
    const c = cap();
    const kpiPath = tpl('kpi');
    const code = await run(['validate', '--json', kpiPath, bad], c.io);
    expect(code).toBe(1);
    const parsed = JSON.parse(c.out) as { file: string; result: unknown }[];
    expect(parsed.map((p) => p.file)).toEqual([kpiPath, bad]);
    expect(parsed[0]!.result).toEqual(
      JSON.parse(JSON.stringify(validateCardFile(good, { filename: 'service-health.json' }))),
    );
    expect(parsed[1]!.result).toMatchObject({ broken: true, reason: 'malformed-json' });
  });

  it('--json stdin uses "-" as file name', async () => {
    const c = cap(good);
    // filename check skipped, so the template id need not match
    expect(await run(['validate', '--json', '-'], c.io)).toBe(0);
    expect((JSON.parse(c.out) as { file: string }[])[0]!.file).toBe('-');
  });

  it('does not need a data dir (env without home)', async () => {
    const c = cap('', { [ENV_HOME]: join(dir, 'never-created') });
    expect(await run(['validate', tpl('kpi')], c.io)).toBe(0);
    expect(() => mkdirSync(join(dir, 'never-created'))).not.toThrow();
  });
});

describe('cross-cutting', () => {
  it('--version prints package version, exit 0', async () => {
    const c = cap();
    expect(await run(['--version'], c.io)).toBe(0);
    expect(c.out.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('--help exit 0 lists validate', async () => {
    const c = cap();
    expect(await run(['--help'], c.io)).toBe(0);
    expect(c.out).toMatch(/validate/);
  });

  it('unknown command -> 2 single line', async () => {
    const c = cap();
    expect(await run(['frobnicate'], c.io)).toBe(2);
    expect(c.err.trim().split('\n')).toHaveLength(1);
  });

  it('red only on TTY without NO_COLOR', async () => {
    const f = join(dir, 'nope.json');
    const tty = cap();
    tty.io.isTTY = true;
    await run(['validate', f], tty.io);
    expect(tty.err).toContain('\x1b[31m');
    const nc = cap('', { NO_COLOR: '1' });
    nc.io.isTTY = true;
    await run(['validate', f], nc.io);
    expect(nc.err).not.toContain('\x1b[');
  });

  it('unexpected error: stack only with CRONTICK_DASHBOARD_VERBOSE', async () => {
    const throwing = cap('', {});
    throwing.io.readStdin = async () => {
      throw new Error('boom');
    };
    expect(await run(['validate', '-'], throwing.io)).toBe(1);
    expect(throwing.err).not.toMatch(/\n\s+at /);
    const v = cap('', { [ENV_VERBOSE]: '1' });
    v.io.readStdin = throwing.io.readStdin;
    await run(['validate', '-'], v.io);
    expect(v.err).toMatch(/\n\s+at /);
  });
});

describe('node guard', () => {
  it('checkNodeVersion compares against 22.5', () => {
    expect(checkNodeVersion('22.5.0')).toBeNull();
    expect(checkNodeVersion('24.1.2')).toBeNull();
    expect(checkNodeVersion('22.4.9')).toMatch(/requires Node >=22\.5.*22\.4\.9/);
    expect(checkNodeVersion('20.11.0')).toMatch(/requires Node/);
  });

  it('old Node: prints message, exit 1, never imports the CLI', async () => {
    let imported = false;
    let err = '';
    let code: number | undefined;
    await guardedMain({
      version: '18.19.0',
      load: async () => {
        imported = true;
        return { main: async () => {} };
      },
      stderr: (s) => void (err += s),
      exit: (c) => void (code = c),
    });
    expect(imported).toBe(false);
    expect(code).toBe(1);
    expect(err).toMatch(/requires Node >=22\.5/);
  });

  it('new Node: loads and runs the CLI', async () => {
    let ran = false;
    await guardedMain({
      version: '22.5.0',
      load: async () => ({
        main: async () => {
          ran = true;
        },
      }),
      stderr: () => {},
      exit: () => {},
    });
    expect(ran).toBe(true);
  });
});

describe('spawned binary (tsx)', () => {
  const entry = join(root, 'src', 'cli', 'index.ts');
  const spawn = (args: string[], input?: string) =>
    spawnSync(process.execPath, ['--import', 'tsx', entry, ...args], {
      encoding: 'utf8',
      input,
      env: { ...process.env, NO_COLOR: '1' },
    });

  it('exit codes 0/1/2 end to end', () => {
    expect(spawn(['validate', tpl('kpi')]).status).toBe(0);
    const bad = write('b.json', '{');
    const r1 = spawn(['validate', bad]);
    expect(r1.status).toBe(1);
    expect(r1.stdout).toMatch(/BROKEN/);
    const r2 = spawn(['validate', join(dir, 'missing.json')]);
    expect(r2.status).toBe(2);
    expect(r2.stderr.trim().split('\n')).toHaveLength(1);
  });

  it('stdin end to end', () => {
    const r = spawn(['validate', '-'], good);
    expect(r.status).toBe(0);
  });
});
