import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_NAME } from '../constants/app.js';
import { SKILL_FILENAME } from '../constants/cli.js';

export class SkillInstallError extends Error {
  constructor(
    readonly reason: 'not-found' | 'differs',
    message: string,
  ) {
    super(message);
    this.name = 'SkillInstallError';
  }
}

export interface InstallSkillOptions {
  /** Packaged SKILL.md. */
  skillPath: string;
  /** Skills directory; the skill lands in <skillsDir>/<APP_NAME>/SKILL.md. */
  skillsDir: string;
  /** Overwrite a differing installed file. */
  force?: boolean;
  /** Package version (for messages only). */
  version: string;
  pid?: number;
}

export interface InstallSkillResult {
  status: 'installed' | 'up-to-date';
  dest: string;
}

/** Copies the packaged SKILL.md into the skills dir as a regular file (atomic tmp+rename, never a symlink). */
export function installSkill(opts: InstallSkillOptions): InstallSkillResult {
  const { skillPath, skillsDir, force, version } = opts;
  if (!existsSync(skillPath)) throw new SkillInstallError('not-found', `packaged ${SKILL_FILENAME} not found at ${skillPath}`);
  const content = readFileSync(skillPath);
  const destDir = join(skillsDir, APP_NAME);
  const dest = join(destDir, SKILL_FILENAME);
  if (existsSync(dest)) {
    if (readFileSync(dest).equals(content)) return { status: 'up-to-date', dest };
    if (!force) throw new SkillInstallError('differs', `${dest} differs from the packaged skill (v${version}); rerun with --force to overwrite`);
  }
  mkdirSync(destDir, { recursive: true });
  const tmp = join(destDir, `.${SKILL_FILENAME}.${opts.pid ?? process.pid}.tmp`);
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, dest);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return { status: 'installed', dest };
}
