import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { APP_NAME } from '../../src/constants/app.js';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { packageAssets, packageVersion, resolveUiDir } from '../../src/cli/assets.js';
import { ERROR_CODES } from '../../src/constants/error-codes.js';
import { AppError } from '../../src/utils/errors.js';

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'cd-assets-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const pkg = (dir: string, name: string): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name }));
};

describe('packageAssets', () => {
  it('walks up to the crontick-dashboard package.json, skipping other packages', () => {
    const root = tmp();
    pkg(root, 'crontick-dashboard');
    pkg(join(root, 'node_modules', 'other'), 'other');
    const start = join(root, 'dist', 'cli');
    mkdirSync(start, { recursive: true });
    const a = packageAssets(start);
    expect(a.root).toBe(root);
    expect(a.schemasDir).toBe(join(root, 'schemas'));
    expect(a.templatesDir).toBe(join(root, 'templates'));
    expect(a.skillPath).toBe(join(root, 'src', 'skill', 'SKILL.md'));
  });

  it('accepts a file URL as start', () => {
    const root = tmp();
    pkg(root, 'crontick-dashboard');
    mkdirSync(join(root, 'dist'), { recursive: true });
    expect(packageAssets(new URL(`file://${join(root, 'dist', 'x.js')}`)).root).toBe(root);
  });

  it('throws when no crontick-dashboard package is found', () => {
    const root = tmp();
    pkg(root, 'something-else');
    expect(() => packageAssets(root)).toThrow(/crontick-dashboard/);
  });
});

describe('resolveUiDir', () => {
  it('resolves ../ui relative to the entry dir when index.html exists', () => {
    const root = tmp();
    mkdirSync(join(root, 'ui'), { recursive: true });
    writeFileSync(join(root, 'ui', 'index.html'), '<html></html>');
    mkdirSync(join(root, 'cli'), { recursive: true });
    expect(resolveUiDir(join(root, 'cli'))).toBe(join(root, 'ui'));
  });

  it('throws NOT_BUILT mentioning npm run build when index.html is missing', () => {
    const root = tmp();
    mkdirSync(join(root, 'cli'), { recursive: true });
    try {
      resolveUiDir(join(root, 'cli'));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe(ERROR_CODES.NOT_BUILT);
      expect((e as Error).message).toContain('npm run build');
    }
  });
});

describe('packageVersion', () => {
  it('reads version from the package.json found by walking up', () => {
    const root = tmp();
    mkdirSync(join(root, 'a', 'b'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: APP_NAME, version: '9.8.7' }));
    expect(packageVersion(join(root, 'a', 'b'))).toBe('9.8.7');
  });
});
