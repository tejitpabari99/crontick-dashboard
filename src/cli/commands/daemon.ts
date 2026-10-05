import { join } from 'node:path';
import type { Command } from 'commander';
import { daemonStart, daemonStatus, daemonStop, type DaemonStartOptions } from '../../lifecycle.js';
import { packageAssets } from '../assets.js';
import { CliError, type CliContext } from '../io.js';

export interface DaemonDeps {
  /** Server entry to spawn. Default: <package root>/dist/server/index.js (the bundled lifecycle's own default would resolve under dist/cli). */
  serverEntry?: string;
  nodeArgs?: string[];
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
}

export function createDaemonRegister(deps: DaemonDeps = {}) {
  return (program: Command, ctx: CliContext): void => {
    const env = (): NodeJS.ProcessEnv => ctx.io.env as NodeJS.ProcessEnv;
    const daemon = program.command('daemon').description('Manage the background server');

    daemon
      .command('start')
      .description('Start the background server (idempotent); waits until healthy')
      .action(async () => {
        const o: DaemonStartOptions = {
          env: env(),
          serverEntry: deps.serverEntry ?? join(packageAssets().root, 'dist', 'server', 'index.js'),
        };
        if (deps.nodeArgs) o.nodeArgs = deps.nodeArgs;
        if (deps.startupTimeoutMs !== undefined) o.startupTimeoutMs = deps.startupTimeoutMs;
        let r;
        try {
          r = await daemonStart(o);
        } catch (err) {
          throw new CliError(err instanceof Error ? err.message : String(err), 1);
        }
        ctx.io.stdout(`${r.alreadyRunning ? 'already running' : 'started'}: ${r.url} (pid ${r.pid}, port ${r.port})\n`);
        ctx.io.stdout(`Log: ${r.logPath}\n`);
      });

    daemon
      .command('stop')
      .description('Stop the background server (not running is success)')
      .action(async () => {
        const r = await daemonStop({ env: env(), ...(deps.stopTimeoutMs !== undefined ? { stopTimeoutMs: deps.stopTimeoutMs } : {}) });
        if (r.mode === 'already-stopped') {
          ctx.io.stdout('not running\n');
          return;
        }
        if (!r.stopped) throw new CliError(`daemon (pid ${r.pid ?? '?'}) is still alive after stop timeout`, 1);
        ctx.io.stdout(`stopped (pid ${r.pid ?? '?'}, ${r.mode})\n`);
      });

    daemon
      .command('status')
      .description('Show daemon status (exit 0 running, 3 stopped)')
      .option('--json', 'machine-readable output')
      .action(async (opts: { json?: boolean }) => {
        const s = await daemonStatus({ env: env() });
        if (!s.running) ctx.setExitCode(3);
        if (opts.json) {
          ctx.io.stdout(`${JSON.stringify(s, null, 2)}\n`);
          return;
        }
        if (!s.running) {
          ctx.io.stdout(`stopped\nData dir: ${s.dataDir}\n`);
          return;
        }
        ctx.io.stdout(`running${s.unhealthy ? ' (unhealthy)' : ''}: ${s.url ?? ''} (pid ${s.pid ?? '?'})\nData dir: ${s.dataDir}\n`);
      });
  };
}

export const registerDaemon = createDaemonRegister();
