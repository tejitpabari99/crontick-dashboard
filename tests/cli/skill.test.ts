import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command, CommanderError } from 'commander';
import { describe, expect, it } from 'vitest';
import { createSkillRegister } from '../../src/cli/commands/skill.js';
import { CliError, type CliContext, type CliIo } from '../../src/cli/main.js';
import { run } from '../../src/cli/main.js';

const tmp = (): string => mkdtempSync(join(tmpdir(), 'skill-'));

async function exec(argv: string[], deps: { homedir: () => string; skillPath: string; version?: string }) {
  const c = { out: '', err: '', code: 0 };
  const io: CliIo = { stdout: (s) => void (c.out += s), stderr: (s) => void (c.err += s), readStdin: async () => '', env: {}, isTTY: false };
  const ctx: CliContext = { io, setExitCode: (n) => void (c.code = n), verbose: () => false };
  const program = new Command().exitOverride().configureOutput({ writeOut: () => {}, writeErr: () => {} });
  createSkillRegister({ version: '1.2.3', ...deps })(program, ctx);
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (e) {
    if (e instanceof CliError) {
      c.err += e.message;
      c.code = e.exitCode;
    } else if (e instanceof CommanderError) c.code = 2;
    else throw e;
  }
  return c;
}

function setup(homeName = 'home') {
  const root = tmp();
  const skillPath = join(root, 'SKILL.md');
  writeFileSync(skillPath, '# skill v1\n');
  const home = join(root, homeName);
  return { root, skillPath, home, deps: { homedir: () => home, skillPath } };
}

describe('skill install', () => {
  it('first install creates parent dirs, equals packaged file, regular file, prints path+version', async () => {
    const s = setup('home with spaces');
    const c = await exec(['skill', 'install'], s.deps);
    const dest = join(s.home, '.claude', 'skills', 'crontick-dashboard', 'SKILL.md');
    expect(c.code).toBe(0);
    expect(readFileSync(dest, 'utf8')).toBe('# skill v1\n');
    expect(lstatSync(dest).isFile()).toBe(true);
    expect(lstatSync(dest).isSymbolicLink()).toBe(false);
    expect(c.out).toContain(dest);
    expect(c.out).toContain('1.2.3');
    expect(readdirSync(join(s.home, '.claude', 'skills', 'crontick-dashboard'))).toEqual(['SKILL.md']);
  });

  it('second install is a no-op exit 0', async () => {
    const s = setup();
    await exec(['skill', 'install'], s.deps);
    const c = await exec(['skill', 'install'], s.deps);
    expect(c.code).toBe(0);
    expect(c.out).toContain('already up to date');
  });

  it('modified dest exits 1 without --force, overwritten with --force', async () => {
    const s = setup();
    const dir = join(s.root, 'skills dir');
    await exec(['skill', 'install', '--dir', dir], s.deps);
    const dest = join(dir, 'crontick-dashboard', 'SKILL.md');
    writeFileSync(dest, 'local edit');
    const c = await exec(['skill', 'install', '--dir', dir], s.deps);
    expect(c.code).toBe(1);
    expect(c.err).toContain('--force');
    expect(readFileSync(dest, 'utf8')).toBe('local edit');
    const f = await exec(['skill', 'install', '--dir', dir, '--force'], s.deps);
    expect(f.code).toBe(0);
    expect(readFileSync(dest, 'utf8')).toBe('# skill v1\n');
    expect(readdirSync(join(dir, 'crontick-dashboard'))).toEqual(['SKILL.md']);
  });

  it('Windows-style --dir and homedir strings are used verbatim-joined', async () => {
    const s = setup();
    const c = await exec(['skill', 'install', '--dir', join(s.root, 'C:\\Users\\x y', 'skills')], s.deps);
    expect(c.code).toBe(0);
    mkdirSync(join(s.root, 'ok'));
    const d = await exec(['skill', 'install'], { ...s.deps, homedir: () => join(s.root, 'C:\\Users\\x') });
    expect(d.code).toBe(0);
  });

  it('missing packaged SKILL.md fails clearly with exit 1', async () => {
    const s = setup();
    const c = await exec(['skill', 'install'], { ...s.deps, skillPath: join(s.root, 'nope.md') });
    expect(c.code).toBe(1);
    expect(c.err).toContain('SKILL.md');
  });

  it('unknown commands (ticktick) and subcommands exit 2', async () => {
    const io: CliIo = { stdout: () => {}, stderr: () => {}, readStdin: async () => '', env: {}, isTTY: false };
    expect(await run(['ticktick'], io)).toBe(2);
    expect(await run(['skill', 'bogus'], io)).toBe(2);
  });
});
