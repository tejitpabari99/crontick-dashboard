import { homedir as osHomedir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import { CLAUDE_SKILLS_SUBDIR } from '../../constants/cli.js';
import { installSkill, SkillInstallError } from '../../skill/install.js';
import { packageAssets, packageVersion } from '../assets.js';
import { CliError, type CliContext } from '../io.js';

export interface SkillDeps {
  homedir: () => string;
  skillPath: string;
  version: string;
}

function defaultDeps(): SkillDeps {
  const assets = packageAssets();
  return { homedir: osHomedir, skillPath: assets.skillPath, version: packageVersion() };
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
        const skillsDir = opts.dir ?? join(deps.homedir(), ...CLAUDE_SKILLS_SUBDIR);
        try {
          const { status, dest } = installSkill({ skillPath: deps.skillPath, skillsDir, version: deps.version, ...(opts.force ? { force: true } : {}) });
          ctx.io.stdout(status === 'up-to-date' ? `already up to date: ${dest} (v${deps.version})\n` : `installed ${dest} (v${deps.version})\n`);
        } catch (e) {
          if (e instanceof SkillInstallError) throw new CliError(e.message, 1);
          throw e;
        }
      });
  };
}

export const registerSkill = createSkillRegister();
