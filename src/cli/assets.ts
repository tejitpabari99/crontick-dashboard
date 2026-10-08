/** Locates packaged assets (schemas, templates, SKILL.md, built UI) relative to the running module. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME } from '../constants/app.js';
import { ERROR_CODES } from '../constants/error-codes.js';
import { AppError, notBuiltError } from '../utils/errors.js';

export interface PackageAssets {
  root: string;
  schemasDir: string;
  templatesDir: string;
  skillPath: string;
}

const toDir = (from: string | URL): string => {
  const p = from instanceof URL || from.startsWith('file:') ? fileURLToPath(from) : from;
  return /\.[cm]?[jt]s$/.test(p) ? dirname(p) : p;
};

/** Walk up from `from` (dir, path, or file URL; default this module) to the package.json named after the app. */
export function packageAssets(from: string | URL = import.meta.url): PackageAssets {
  let dir = resolve(toDir(from));
  for (;;) {
    const file = join(dir, 'package.json');
    if (existsSync(file)) {
      try {
        if ((JSON.parse(readFileSync(file, 'utf8')) as { name?: string }).name === APP_NAME) {
          return {
            root: dir,
            schemasDir: join(dir, 'schemas'),
            templatesDir: join(dir, 'templates'),
            skillPath: join(dir, 'src', 'skill', 'SKILL.md'),
          };
        }
      } catch {
        /* unreadable package.json: keep walking */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) throw new AppError(
        ERROR_CODES.PACKAGE_ROOT_NOT_FOUND,
        `could not locate ${APP_NAME} package root from ${toDir(from)}; reinstall the package`,
      );
    dir = parent;
  }
}

/** The package.json `version` of the running package. */
export function packageVersion(from: string | URL = import.meta.url): string {
  const root = packageAssets(from).root;
  return (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version;
}

/** UI dir for entries living one level under dist/ (dist/cli, dist/server): `<entryDir>/../ui`. Throws AppError NOT_BUILT if absent. */
export function resolveUiDir(from: string | URL = import.meta.url): string {
  const uiDir = resolve(toDir(from), '..', 'ui');
  if (!existsSync(join(uiDir, 'index.html'))) throw notBuiltError('UI', uiDir);
  return uiDir;
}
