import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PORT } from '../../src/constants/http.js';
import { createInfoRegister } from '../../src/cli/commands/info.js';
import { run, type CliContext, type CliIo } from '../../src/cli/main.js';
import { ENV_HOME } from '../../src/constants/env.js';

function cap(env: Record<string, string | undefined> = {}) {
  const c = { out: '', err: '', io: undefined as unknown as CliIo };
  c.io = {
    stdout: (s) => void (c.out += s),
    stderr: (s) => void (c.err += s),
    readStdin: async () => '',
    env,
    isTTY: false,
  };
  return c;
}
const home = (): string => mkdtempSync(join(tmpdir(), 'info-'));

describe('info', () => {
  it('--json emits exactly the frozen fields with daemon stopped', async () => {
    const h = home();
    const c = cap({ [ENV_HOME]: h });
    expect(await run(['info', '--json'], c.io)).toBe(0);
    const j = JSON.parse(c.out) as Record<string, unknown>;
    expect(Object.keys(j).sort()).toEqual(
      ['version', 'dataDir', 'feedDir', 'url', 'running', 'configPath', 'templatesDir', 'schemasDir', 'skillPath', 'notifications'].sort(),
    );
    expect(j.running).toBe(false);
    expect(j.url).toBeNull();
    expect(Object.keys(j.notifications as object).sort()).toEqual(['mode', 'reason']);
    expect(j.dataDir).toBe(h);
    expect(j.feedDir).toBe(join(h, 'feed'));
    expect(j.configPath).toBe(join(h, 'config.json'));
    expect(existsSync(j.feedDir as string)).toBe(false); // no side effects
    // skillPath existence is asserted in Task 8/9 (SKILL.md is authored in Task 8)
    expect(existsSync(j.templatesDir as string)).toBe(true);
    expect(existsSync(j.schemasDir as string)).toBe(true);
    const v = await run(['--version'], cap().io);
    expect(v).toBe(0);
  });

  it('version matches --version', async () => {
    const a = cap({ [ENV_HOME]: home() });
    await run(['info', '--json'], a.io);
    const b = cap();
    await run(['--version'], b.io);
    expect(b.out.trim()).toBe((JSON.parse(a.out) as { version: string }).version);
  });

  it('human output has all labels and the default port', async () => {
    const c = cap({ [ENV_HOME]: home() });
    expect(await run(['info'], c.io)).toBe(0);
    for (const l of ['Version', 'Data dir', 'Feed dir', 'URL', 'Config', 'Templates', 'Schemas', 'Skill', 'Notifications']) {
      expect(c.out).toContain(l);
    }
    expect(c.out).toContain('not running');
    expect(c.out).toContain(String(DEFAULT_PORT));
  });

  it('running daemon reports url and running (injected status)', async () => {
    const c = cap({ [ENV_HOME]: home() });
    let code = 0;
    const ctx: CliContext = { io: c.io, setExitCode: (n) => void (code = n), verbose: () => false };
    const program = new Command().exitOverride();
    createInfoRegister({
      daemonStatus: async () => ({ running: true, pid: 1, port: 5555, url: 'http://127.0.0.1:5555', dataDir: 'x' }),
    })(program, ctx);
    await program.parseAsync(['info', '--json'], { from: 'user' });
    const j = JSON.parse(c.out) as { running: boolean; url: string };
    expect(j.running).toBe(true);
    expect(j.url).toBe('http://127.0.0.1:5555');
    expect(code).toBe(0);
    const h = cap({ [ENV_HOME]: home() });
    const p2 = new Command().exitOverride();
    createInfoRegister({ daemonStatus: async () => ({ running: true, url: 'http://127.0.0.1:5555', dataDir: 'x' }) })(p2, { ...ctx, io: h.io });
    await p2.parseAsync(['info'], { from: 'user' });
    expect(h.out).toContain('http://127.0.0.1:5555');
  });
});
