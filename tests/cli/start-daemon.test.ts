import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDaemonRegister } from '../../src/cli/commands/daemon.js';
import { createStartRegister } from '../../src/cli/commands/start.js';
import { CliError, type CliContext, type CliIo } from '../../src/cli/io.js';
import { isPidAlive } from '../../src/pid.js';
import { pidFilePath } from '../../src/paths.js';

let data: string;
let ui: string;
let port = 48200;
let env: NodeJS.ProcessEnv;
let blocker: Server | undefined;
const entry = join(process.cwd(), 'src/server/index.ts');
const spawnDeps = () => ({ serverEntry: entry, nodeArgs: ['--import', 'tsx'], startupTimeoutMs: 20_000, stopTimeoutMs: 5_000 });

/** Runs argv through the real registers with test deps; mirrors main.run's error handling. */
async function exec(argv: string[], startDeps: Parameters<typeof createStartRegister>[0] = {}) {
  const c = { out: '', err: '', code: 0 };
  const io: CliIo = { stdout: (s) => void (c.out += s), stderr: (s) => void (c.err += s), readStdin: async () => '', env, isTTY: false };
  const ctx: CliContext = { io, setExitCode: (n) => void (c.code = n), verbose: () => false };
  const program = new Command().exitOverride();
  createStartRegister({ uiDir: () => ui, ...startDeps })(program, ctx);
  createDaemonRegister(spawnDeps())(program, ctx);
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    c.err += `${e.message}\n`;
    c.code = e.exitCode;
  }
  return c;
}

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'cli-sd-data-'));
  ui = mkdtempSync(join(tmpdir(), 'cli-sd-ui-'));
  writeFileSync(join(ui, 'index.html'), '<html>SPA</html>');
  port += 1;
  env = { ...process.env, CRONTICK_DASHBOARD_HOME: data, CRONTICK_DASHBOARD_PORT: String(port), CRONTICK_DASHBOARD_UI_DIR: ui };
});
afterEach(async () => {
  const pid = Number.parseInt(existsSync(pidFilePath(env)) ? readFileSync(pidFilePath(env), 'utf8') : '', 10);
  if (Number.isInteger(pid) && isPidAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone */
    }
    for (let i = 0; i < 100 && isPidAlive(pid); i++) await new Promise((r) => setTimeout(r, 20));
  }
  if (blocker) await new Promise((r) => blocker?.close(r));
  blocker = undefined;
  rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  rmSync(ui, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('daemon commands', () => {
  it('double start = one process; status 0 then 3 after stop; stop when stopped exits 0', async () => {
    expect((await exec(['daemon', 'status'])).code).toBe(3);
    expect((await exec(['daemon', 'status', '--json'])).out).toContain('"running": false');
    const stopped = await exec(['daemon', 'stop']);
    expect(stopped.code).toBe(0);
    expect(stopped.out).toContain('not running');

    const a = await exec(['daemon', 'start']);
    expect(a.code).toBe(0);
    expect(a.out).toContain(`http://127.0.0.1:${port}`);
    const pid = Number.parseInt(readFileSync(pidFilePath(env), 'utf8'), 10);
    const b = await exec(['daemon', 'start']);
    expect(b.code).toBe(0);
    expect(b.out).toContain('already running');
    expect(Number.parseInt(readFileSync(pidFilePath(env), 'utf8'), 10)).toBe(pid);

    const st = await exec(['daemon', 'status']);
    expect(st.code).toBe(0);
    expect(st.out).toContain(String(pid));
    const sj = JSON.parse((await exec(['daemon', 'status', '--json'])).out) as { running: boolean; pid: number; url: string };
    expect(sj).toMatchObject({ running: true, pid, url: `http://127.0.0.1:${port}` });

    const stop = await exec(['daemon', 'stop']);
    expect(stop.code).toBe(0);
    expect(isPidAlive(pid)).toBe(false);
    expect((await exec(['daemon', 'status'])).code).toBe(3);
  }, 60_000);

  it('start against a running daemon refuses (exit 1) and prints its URL', async () => {
    await exec(['daemon', 'start']);
    const s = await exec(['start']);
    expect(s.code).toBe(1);
    expect(s.err).toContain(`http://127.0.0.1:${port}`);
    await exec(['daemon', 'stop']);
  }, 60_000);

  it('daemon start failure surfaces as CliError (exit 1)', async () => {
    const c = { out: '', err: '', code: 0 };
    const io: CliIo = { stdout: (s) => void (c.out += s), stderr: (s) => void (c.err += s), readStdin: async () => '', env, isTTY: false };
    const program = new Command().exitOverride();
    createDaemonRegister({ serverEntry: join(data, 'missing.js') })(program, { io, setExitCode: () => {}, verbose: () => false });
    await expect(program.parseAsync(['daemon', 'start'], { from: 'user' })).rejects.toBeInstanceOf(CliError);
  });
});

describe('start (foreground)', () => {
  it('prints URL and feed dir, stops cleanly on signal', async () => {
    let fire: () => void = () => {};
    let armed = false;
    const done = exec(['start'], {
      onSignal: (h) => {
        fire = h;
        armed = true;
        return () => {};
      },
    });
    for (let i = 0; i < 200 && !existsSync(pidFilePath(env)); i++) await new Promise((r) => setTimeout(r, 25));
    for (let i = 0; i < 400 && !armed; i++) await new Promise((r) => setTimeout(r, 25));
    expect((await fetch(`http://127.0.0.1:${port}/api/health`)).ok).toBe(true);
    fire();
    const c = await done;
    expect(c.code).toBe(0);
    expect(c.out).toContain(`http://127.0.0.1:${port}`);
    expect(c.out).toContain(join(data, 'feed'));
    expect(existsSync(pidFilePath(env))).toBe(false);
  }, 30_000);

  it('occupied port shows the fallback notice', async () => {
    blocker = createServer((_, res) => res.end('x'));
    await new Promise<void>((r) => blocker?.listen(port, '127.0.0.1', r));
    let fire: () => void = () => {};
    let armed = false;
    const done = exec(['start'], {
      onSignal: (h) => {
        fire = h;
        armed = true;
        return () => {};
      },
    });
    for (let i = 0; i < 200 && !existsSync(pidFilePath(env)); i++) await new Promise((r) => setTimeout(r, 25));
    for (let i = 0; i < 400 && !armed; i++) await new Promise((r) => setTimeout(r, 25));
    fire();
    const c = await done;
    expect(c.code).toBe(0);
    expect(c.err + c.out).toContain(`Port ${port} is in use`);
    expect(c.out).not.toContain(`127.0.0.1:${port}\n`);
  }, 30_000);

  it('NOT_BUILT UI exits 1', async () => {
    const c = await exec(['start'], {
      uiDir: () => {
        throw new CliError('NOT_BUILT: UI not found (run npm run build)', 1);
      },
    });
    expect(c.code).toBe(1);
    expect(c.err).toContain('NOT_BUILT');
  });
});
