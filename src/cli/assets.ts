/** Locates packaged assets (schemas, templates, SKILL.md, built UI) relative to the running module. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_NAME = 'crontick-dashboard';

export class NotBuiltError extends Error {
  readonly code = 'NOT_BUILT';
  constructor(uiDir: string) {
    super(`NOT_BUILT: UI not found at ${uiDir} (run npm run build)`);
    this.name = 'NotBuiltError';
  }
}

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

/** Walk up from `from` (dir, path, or file URL; default this module) to the package.json named crontick-dashboard. */
export function packageAssets(from: string | URL = import.meta.url): PackageAssets {
  let dir = resolve(toDir(from));
  for (;;) {
    const file = join(dir, 'package.json');
    if (existsSync(file)) {
      try {
        if ((JSON.parse(readFileSync(file, 'utf8')) as { name?: string }).name === PACKAGE_NAME) {
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
    if (parent === dir) throw new Error(`could not locate ${PACKAGE_NAME} package root from ${toDir(from)}`);
    dir = parent;
  }
}

/** UI dir for entries living one level under dist/ (dist/cli, dist/server): `<entryDir>/../ui`. Throws NOT_BUILT if absent. */
export function resolveUiDir(from: string | URL = import.meta.url): string {
  const uiDir = resolve(toDir(from), '..', 'ui');
  if (!existsSync(join(uiDir, 'index.html'))) throw new NotBuiltError(uiDir);
  return uiDir;
}
