import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PackageAssets } from '../../src/cli/assets.js';
import { ENV_HOME } from '../../src/constants/env.js';
import { syncSchemas } from '../../src/schemas-sync.js';

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'cd-sync-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const pkg = tmp();
  const data = join(tmp(), 'data');
  const schemasDir = join(pkg, 'schemas');
  mkdirSync(schemasDir);
  writeFileSync(join(schemasDir, 'a.json'), '{"a":1}');
  writeFileSync(join(schemasDir, 'b.json'), '{"b":1}');
  writeFileSync(join(schemasDir, 'notes.txt'), 'ignored');
  const assets = { root: pkg, schemasDir, templatesDir: '', skillPath: '' } as PackageAssets;
  const env = { [ENV_HOME]: data } as NodeJS.ProcessEnv;
  return { assets, env, out: join(data, 'schemas'), schemasDir };
}

describe('syncSchemas', () => {
  it('copies json schemas on first run', () => {
    const { assets, env, out } = setup();
    const r = syncSchemas(env, assets);
    expect(r.synced.sort()).toEqual(['a.json', 'b.json']);
    expect(r.unchanged).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(readFileSync(join(out, 'a.json'), 'utf8')).toBe('{"a":1}');
    expect(existsSync(join(out, 'notes.txt'))).toBe(false);
  });

  it('rerun is idempotent and does not write', () => {
    const { assets, env, out } = setup();
    syncSchemas(env, assets);
    const old = new Date(2000, 0, 1);
    utimesSync(join(out, 'a.json'), old, old);
    const r = syncSchemas(env, assets);
    expect(r.synced).toEqual([]);
    expect(r.unchanged.sort()).toEqual(['a.json', 'b.json']);
    expect(statSync(join(out, 'a.json')).mtimeMs).toBe(old.getTime());
  });

  it('overwrites changed content', () => {
    const { assets, env, out } = setup();
    syncSchemas(env, assets);
    writeFileSync(join(out, 'a.json'), 'stale');
    const r = syncSchemas(env, assets);
    expect(r.synced).toEqual(['a.json']);
    expect(r.unchanged).toEqual(['b.json']);
    expect(readFileSync(join(out, 'a.json'), 'utf8')).toBe('{"a":1}');
  });

  it('never deletes extra files', () => {
    const { assets, env, out } = setup();
    syncSchemas(env, assets);
    writeFileSync(join(out, 'custom.json'), 'mine');
    syncSchemas(env, assets);
    expect(readFileSync(join(out, 'custom.json'), 'utf8')).toBe('mine');
  });

  it('warns without throwing when target is unwritable', () => {
    const { assets } = setup();
    const blocker = join(tmp(), 'file');
    writeFileSync(blocker, 'x');
    const env = { [ENV_HOME]: blocker } as NodeJS.ProcessEnv;
    const r = syncSchemas(env, assets);
    expect(r.synced).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('warns when the packaged schemas dir is missing', () => {
    const { env } = setup();
    const r = syncSchemas(env, { root: '', schemasDir: join(tmp(), 'nope'), templatesDir: '', skillPath: '' });
    expect(r.warnings.length).toBe(1);
  });
});
