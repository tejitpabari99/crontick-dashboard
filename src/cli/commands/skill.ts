import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import { packageAssets } from '../assets.js';
import { CliError, type CliContext } from '../io.js';

export interface SkillDeps {
  homedir: () => string;
  skillPath: string;
  version: string;
}

function defaultDeps(): SkillDeps {
  const assets = packageAssets();
  const pkg = JSON.parse(readFileSync(join(assets.root, 'package.json'), 'utf8')) as { version: string };
  return { homedir: osHomedir, skillPath: assets.skillPath, version: pkg.version };
}

export function createSkillRegister(overrides: Partial<SkillDeps> = {}) {
  return (program: Command, ctx: CliContext): void => {
    const skill = program.command('skill').description('Manage the Claude skill that teaches agents to write cards');
    skill
      .command('install')
      .description('Copy the packaged SKILL.md to <skillsDir>/crontick-dashboard/SKILL.md (never a symlink)')
      .option('--dir <skillsDir>', 'skills directory (default ~/.claude/skills)')
      .option('--force', 'overwrite a differing installed SKILL.md')
      .action((opts: { dir?: string; force?: boolean }) => {
        const deps = { ...defaultDeps(), ...overrides };
        if (!existsSync(deps.skillPath)) throw new CliError(`packaged SKILL.md not found at ${deps.skillPath}`, 1);
        const content = readFileSync(deps.skillPath);
        const skillsDir = opts.dir ?? join(deps.homedir(), '.claude', 'skills');
        const destDir = join(skillsDir, 'crontick-dashboard');
        const dest = join(destDir, 'SKILL.md');
        if (existsSync(dest)) {
          if (readFileSync(dest).equals(content)) {
            ctx.io.stdout(`already up to date: ${dest} (v${deps.version})\n`);
            return;
          }
          if (!opts.force) throw new CliError(`${dest} differs from the packaged skill (v${deps.version}); rerun with --force to overwrite`, 1);
        }
        mkdirSync(destDir, { recursive: true });
        const tmp = join(destDir, `.SKILL.md.${process.pid}.tmp`);
        try {
          writeFileSync(tmp, content);
          renameSync(tmp, dest);
        } catch (e) {
          rmSync(tmp, { force: true });
          throw e;
        }
        ctx.io.stdout(`installed ${dest} (v${deps.version})\n`);
      });
  };
}

export const registerSkill = createSkillRegister();
