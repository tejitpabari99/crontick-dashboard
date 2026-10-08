import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fail = vi.hoisted(() => ({ rename: false }));
vi.mock('node:fs', async (orig) => {
  const actual = await orig<typeof import('node:fs')>();
  return {
    ...actual,
    renameSync: (a: string, b: string) => {
      if (fail.rename) throw new Error('boom');
      return actual.renameSync(a, b);
    },
  };
});

import { run, type CliIo } from '../../src/cli/main.js';
import { getExample } from '../../src/contract/index.js';

let home: string;
let out = '';
let err = '';
const io = (): CliIo => ({
  stdout: (s) => void (out += s),
  stderr: (s) => void (err += s),
  readStdin: async () => '',
  env: { CRONTICK_DASHBOARD_HOME: home },
  isTTY: false,
});
const r = (...a: string[]): Promise<number> => run(a, io());
const feed = (): string => join(home, 'feed');
const card = (id: string): Record<string, unknown> => JSON.parse(readFileSync(join(feed(), id, 'card.json'), 'utf8'));

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ct-new-'));
  out = '';
  err = '';
  fail.rename = false;
});

describe('new', () => {
  it('scaffolds card.json only with $schema and default title', async () => {
    expect(await r('new', 'email-summary', '--type', 'table')).toBe(0);
    const dir = join(feed(), 'email-summary');
    expect(readdirSync(dir)).toEqual(['card.json']);
    expect(card('email-summary')).toEqual({ $schema: '../../schemas/card-def.json', type: 'table', title: 'Email summary' });
    expect(out).toBe(`created ${dir}\nnext: write ${join(dir, 'data.json')} (example: crontick-dashboard templates table)\n`);
  });

  it('flags map to layout, title and priority', async () => {
    expect(await r('new', 'x', '--type', 'kpi', '--title', 'T', '--column', 'right', '--order', '3', '--height', 'M', '--priority', '4')).toBe(0);
    expect(card('x')).toMatchObject({ type: 'kpi', title: 'T', layout: { column: 'right', order: 3, height: 'M' }, priority: 4 });
  });

  it('only given layout flags are written', async () => {
    await r('new', 'x', '--type', 'list', '--column', 'left');
    expect(card('x').layout).toEqual({ column: 'left' });
    expect(card('x')).not.toHaveProperty('priority');
  });

  it.each(['alerts', '.hidden', 'Bad_ID', 'a/b'])('rejects id %s with exit 2', async (id) => {
    expect(await r('new', id, '--type', 'table')).toBe(2);
    expect(existsSync(join(feed(), id))).toBe(false);
  });

  it('unknown type exits 2 with UNKNOWN_TYPE', async () => {
    expect(await r('--verbose', 'new', 'x', '--type', 'nope')).toBe(2);
    expect(err).toContain('UNKNOWN_TYPE');
  });

  it.each([
    ['--column', 'middle'],
    ['--height', 'XL'],
    ['--order', 'abc'],
    ['--priority', '6'],
    ['--priority', '1.5'],
  ])('bad %s %s exits 2 INVALID_OPTION', async (flag, val) => {
    err = '';
    expect(await r('--verbose', 'new', 'x', '--type', 'table', flag, val)).toBe(2);
    expect(err).toContain('INVALID_OPTION');
    expect(existsSync(join(feed(), 'x'))).toBe(false);
  });

  it('existing exits 1 CARD_EXISTS; --force rewrites card.json only', async () => {
    await r('new', 'x', '--type', 'table', '--with-example');
    const data = join(feed(), 'x', 'data.json');
    writeFileSync(data, '{"mine":true}');
    writeFileSync(join(feed(), 'x', 'other.txt'), 'keep');
    expect(await r('--verbose', 'new', 'x', '--type', 'table')).toBe(1);
    expect(err).toContain('CARD_EXISTS');
    expect(await r('new', 'x', '--type', 'kpi', '--title', 'New', '--with-example', '--force')).toBe(0);
    expect(card('x')).toMatchObject({ type: 'kpi', title: 'New' });
    expect(readFileSync(data, 'utf8')).toBe('{"mine":true}');
    expect(readdirSync(join(feed(), 'x')).sort()).toEqual(['card.json', 'data.json', 'other.txt']);
  });

  it('leaves nothing behind on failure', async () => {
    fail.rename = true;
    expect(await r('new', 'x', '--type', 'table', '--with-example')).toBe(1);
    expect(readdirSync(feed())).toEqual(expect.not.arrayContaining(['x']));
    expect(readdirSync(feed()).filter((n) => n.startsWith('.new-'))).toEqual([]);
  });

  it('success leaves no temp dir', async () => {
    await r('new', 'x', '--type', 'table');
    expect(readdirSync(feed()).filter((n) => n.startsWith('.new-'))).toEqual([]);
  });

  it('--with-example writes the example data.json', async () => {
    await r('new', 'x', '--type', 'table', '--with-example');
    expect(JSON.parse(readFileSync(join(feed(), 'x', 'data.json'), 'utf8'))).toEqual(getExample('table')!.data);
  });

  it('syncs schemas into <data>/schemas', async () => {
    await r('new', 'x', '--type', 'table');
    expect(existsSync(join(home, 'schemas', 'card-def.json'))).toBe(true);
  });

  it('does not create archive/', async () => {
    await r('new', 'x', '--type', 'table');
    expect(existsSync(join(home, 'archive'))).toBe(false);
  });

  it('--json prints id, dir, cardPath, dataPath, schemasSynced', async () => {
    expect(await r('new', 'x', '--type', 'table', '--json')).toBe(0);
    const j = JSON.parse(out) as Record<string, unknown>;
    const dir = join(feed(), 'x');
    expect(j).toMatchObject({ id: 'x', dir, cardPath: join(dir, 'card.json'), dataPath: join(dir, 'data.json') });
    expect(j.schemasSynced).toContain('card-def.json');
  });
});
