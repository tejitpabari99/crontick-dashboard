import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run, type CliIo } from '../../src/cli/main.js';
import { checkNodeVersion, guardedMain } from '../../src/cli/guard.js';
import { ENV_HOME, ENV_VERBOSE } from '../../src/constants/env.js';

const root = join(import.meta.dirname, '..', '..');
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cd-validate-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const tpl = (type: string, file: 'card' | 'data'): string =>
  readFileSync(join(root, 'templates', type, `${file}.json`), 'utf8');

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
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, text);
  return p;
};
/** Make `<dir>/<id>/` with the given files; returns the folder path. */
function folder(id: string, files: { card?: string; data?: string }): string {
  const f = join(dir, id);
  mkdirSync(f, { recursive: true });
  if (files.card !== undefined) writeFileSync(join(f, 'card.json'), files.card);
  if (files.data !== undefined) writeFileSync(join(f, 'data.json'), files.data);
  return f;
}
const okFolder = (id = 'service-health'): string =>
  folder(id, { card: tpl('kpi', 'card'), data: tpl('kpi', 'data') });
const alertText = JSON.stringify({ title: 'Deploy failed' });

describe('validate folders', () => {
  it('ok folder -> OK line, exit 0', async () => {
    const c = cap();
    expect(await run(['validate', okFolder()], c.io)).toBe(0);
    expect(c.out).toMatch(/^OK service-health \(kpi\)/m);
  });

  it('no data.json -> NO DATA, exit 0, hint', async () => {
    const f = folder('empty', { card: tpl('kpi', 'card') });
    const c = cap();
    expect(await run(['validate', f], c.io)).toBe(0);
    expect(c.out).toMatch(/^NO DATA empty/m);
    expect(c.out).toMatch(/write data\.json/);
  });

  it('truncated data.json -> BROKEN malformed-json, exit 1', async () => {
    const f = folder('trunc', { card: tpl('kpi', 'card'), data: tpl('kpi', 'data').slice(0, 30) });
    const c = cap();
    expect(await run(['validate', f], c.io)).toBe(1);
    expect(c.out).toMatch(/^BROKEN malformed-json: /m);
  });

  it('schema-invalid payload -> BROKEN with issue lines', async () => {
    const f = folder('bad-kpi', { card: tpl('kpi', 'card'), data: JSON.stringify({ data: { items: 'x' } }) });
    const c = cap();
    expect(await run(['validate', f], c.io)).toBe(1);
    expect(c.out).toMatch(/^BROKEN schema-invalid: /m);
    expect(c.out).toMatch(/^ {2}\/data/m);
  });

  it('javascript: link in data -> BROKEN', async () => {
    const data = JSON.parse(tpl('list', 'data')) as { data: { items: { link?: string }[] } };
    data.data.items[0]!.link = 'javascript:alert(1)';
    const f = folder('js-link', { card: tpl('list', 'card'), data: JSON.stringify(data) });
    const c = cap();
    expect(await run(['validate', f], c.io)).toBe(1);
    expect(c.out).toMatch(/^BROKEN /m);
  });

  it('missing card.json -> SKIPPED card-def-missing, exit 1', async () => {
    const f = folder('nocard', { data: tpl('kpi', 'data') });
    const c = cap();
    expect(await run(['validate', f], c.io)).toBe(1);
    expect(c.out).toMatch(/^SKIPPED card-def-missing: /m);
  });

  it('reserved folder name -> SKIPPED reserved-id', async () => {
    const f = folder('alerts', { card: tpl('kpi', 'card') });
    const c = cap();
    expect(await run(['validate', f], c.io)).toBe(1);
    expect(c.out).toMatch(/^SKIPPED reserved-id: /m);
  });

  it('data path escaping via symlink -> SKIPPED data-path-invalid', async () => {
    const f = folder('escape', { card: tpl('kpi', 'card') });
    const outside = write('outside.json', tpl('kpi', 'data'));
    symlinkSync(outside, join(f, 'data.json'));
    const c = cap();
    expect(await run(['validate', f], c.io)).toBe(1);
    expect(c.out).toMatch(/^SKIPPED data-path-invalid: /m);
  });
});

describe('validate path dispatch', () => {
  it('card.json and data.json paths validate the containing folder', async () => {
    const f = okFolder();
    for (const file of ['card.json', 'data.json']) {
      const c = cap();
      expect(await run(['validate', join(f, file)], c.io)).toBe(0);
      expect(c.out).toMatch(/^OK service-health \(kpi\)/m);
    }
  });

  it('other .json file is an alert (id = stem)', async () => {
    const p = write('alerts/deploy-failed.json', alertText);
    const c = cap();
    expect(await run(['validate', p], c.io)).toBe(0);
    expect(c.out).toMatch(/^OK deploy-failed \(alert\)/m);
  });

  it('broken alert file -> BROKEN, exit 1', async () => {
    const p = write('alerts/no-title.json', '{}');
    const c = cap();
    expect(await run(['validate', p], c.io)).toBe(1);
    expect(c.out).toMatch(/^BROKEN schema-invalid: /m);
  });

  it('several paths: header per path, any failure -> 1', async () => {
    const bad = folder('trunc', { card: tpl('kpi', 'card'), data: '{' });
    const c = cap();
    expect(await run(['validate', okFolder(), bad], c.io)).toBe(1);
    expect(c.out).toMatch(/^OK /m);
    expect(c.out).toMatch(/^BROKEN /m);
    expect(c.out).toMatch(/^# /m);
  });

  it('missing path -> 2, single stderr line, no stack', async () => {
    const c = cap();
    expect(await run(['validate', join(dir, 'nope')], c.io)).toBe(2);
    expect(c.err.trim().split('\n')).toHaveLength(1);
    expect(c.err).toMatch(/nope/);
    expect(c.err).not.toMatch(/\n\s+at /);
  });

  it('no path args -> 2 usage error', async () => {
    const c = cap();
    expect(await run(['validate'], c.io)).toBe(2);
    expect(c.err).toMatch(/error/i);
  });

  it('does not need a data dir (env without home)', async () => {
    const c = cap('', { [ENV_HOME]: join(dir, 'never-created') });
    expect(await run(['validate', okFolder()], c.io)).toBe(0);
    expect(existsSync(join(dir, 'never-created'))).toBe(false);
  });
});

describe('validate stdin', () => {
  it('missing --as -> 2', async () => {
    const c = cap(tpl('kpi', 'data'));
    expect(await run(['validate', '-'], c.io)).toBe(2);
    expect(c.err).toMatch(/--as/);
  });

  it('bad --as value -> 2', async () => {
    expect(await run(['validate', '-', '--as', 'nope'], cap('{}').io)).toBe(2);
  });

  it('--as card: ok with default and custom id', async () => {
    const c = cap(tpl('table', 'card'));
    expect(await run(['validate', '-', '--as', 'card'], c.io)).toBe(0);
    expect(c.out).toMatch(/^OK stdin \(table\)/m);
    const c2 = cap(tpl('table', 'card'));
    expect(await run(['validate', '-', '--as', 'card', '--id', 'email-summary'], c2.io)).toBe(0);
    expect(c2.out).toMatch(/^OK email-summary \(table\)/m);
  });

  it('--as card: invalid card.json -> SKIPPED, exit 1', async () => {
    const c = cap('{"type":"table"}');
    expect(await run(['validate', '-', '--as', 'card'], c.io)).toBe(1);
    expect(c.out).toMatch(/^SKIPPED card-def-invalid: /m);
  });

  it('--as data --type: ok, broken, missing/unknown type', async () => {
    const ok = cap(tpl('table', 'data'));
    expect(await run(['validate', '-', '--as', 'data', '--type', 'table'], ok.io)).toBe(0);
    expect(ok.out).toMatch(/^OK stdin \(table\)/m);

    const bad = cap(tpl('table', 'data'));
    expect(await run(['validate', '-', '--as', 'data', '--type', 'kpi'], bad.io)).toBe(1);
    expect(bad.out).toMatch(/^BROKEN schema-invalid: /m);

    expect(await run(['validate', '-', '--as', 'data'], cap('{}').io)).toBe(2);
    expect(await run(['validate', '-', '--as', 'data', '--type', 'nope'], cap('{}').io)).toBe(2);
  });

  it('--as alert: ok and broken', async () => {
    const ok = cap(alertText);
    expect(await run(['validate', '-', '--as', 'alert', '--id', 'disk-full'], ok.io)).toBe(0);
    expect(ok.out).toMatch(/^OK disk-full \(alert\)/m);
    const bad = cap('{');
    expect(await run(['validate', '-', '--as', 'alert'], bad.io)).toBe(1);
    expect(bad.out).toMatch(/^BROKEN malformed-json: /m);
  });

  it('--as without stdin, or several documents -> 2', async () => {
    expect(await run(['validate', okFolder(), '--as', 'card'], cap().io)).toBe(2);
    expect(await run(['validate', '-', '-', '--as', 'card'], cap('{}').io)).toBe(2);
  });
});

describe('validate --json', () => {
  it('prints [{path,result}] with the validator result verbatim', async () => {
    const f = okFolder();
    const bad = folder('trunc', { card: tpl('kpi', 'card'), data: '{' });
    const c = cap();
    expect(await run(['validate', '--json', f, bad], c.io)).toBe(1);
    const parsed = JSON.parse(c.out) as { path: string; result: { status: string; reason?: string; card?: { id: string } } }[];
    expect(parsed.map((p) => p.path)).toEqual([f, bad]);
    expect(parsed[0]!.result.status).toBe('ok');
    expect(parsed[0]!.result.card!.id).toBe('service-health');
    expect(parsed[1]!.result).toMatchObject({ status: 'broken', reason: 'malformed-json' });
  });

  it('no-data and skipped keep their status; stdin path is "-"', async () => {
    const nd = folder('empty', { card: tpl('kpi', 'card') });
    const c = cap();
    expect(await run(['validate', '--json', nd], c.io)).toBe(0);
    expect((JSON.parse(c.out) as { result: { status: string } }[])[0]!.result.status).toBe('no-data');

    const c2 = cap(alertText);
    expect(await run(['validate', '--json', '-', '--as', 'alert'], c2.io)).toBe(0);
    expect((JSON.parse(c2.out) as { path: string }[])[0]!.path).toBe('-');
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
    const f = join(dir, 'nope');
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
    expect(await run(['validate', '-', '--as', 'alert'], throwing.io)).toBe(1);
    expect(throwing.err).not.toMatch(/\n\s+at /);
    const v = cap('', { [ENV_VERBOSE]: '1' });
    v.io.readStdin = throwing.io.readStdin;
    await run(['validate', '-', '--as', 'alert'], v.io);
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
    expect(spawn(['validate', okFolder()]).status).toBe(0);
    const r1 = spawn(['validate', folder('trunc', { card: tpl('kpi', 'card'), data: '{' })]);
    expect(r1.status).toBe(1);
    expect(r1.stdout).toMatch(/BROKEN/);
    const r2 = spawn(['validate', join(dir, 'missing')]);
    expect(r2.status).toBe(2);
    expect(r2.stderr.trim().split('\n')).toHaveLength(1);
  });

  it('stdin end to end', () => {
    expect(spawn(['validate', '-', '--as', 'data', '--type', 'kpi'], tpl('kpi', 'data')).status).toBe(0);
    expect(spawn(['validate', '-'], tpl('kpi', 'data')).status).toBe(2);
  });
});
