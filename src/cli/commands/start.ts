import { join } from 'node:path';
import type { Command } from 'commander';
import { feedDir } from '../../paths.js';
import { runForeground, type ForegroundResult } from '../../lifecycle.js';
import { NotBuiltError, packageAssets, resolveUiDir } from '../assets.js';
import { CliError, type CliContext } from '../io.js';

export interface StartDeps {
  runForeground: typeof runForeground;
  /** Built UI dir; throws NotBuiltError when absent. */
  uiDir: () => string;
  /** Registers a stop handler for SIGINT/SIGTERM; returns a disposer. */
  onSignal: (handler: () => void) => () => void;
}

const defaultDeps: StartDeps = {
  runForeground,
  uiDir: () => resolveUiDir(join(packageAssets().root, 'dist', 'cli')),
  onSignal: (handler) => {
    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
    return () => {
      process.off('SIGINT', handler);
      process.off('SIGTERM', handler);
    };
  },
};

export function createStartRegister(overrides: Partial<StartDeps> = {}) {
  const deps: StartDeps = { ...defaultDeps, ...overrides };
  return (program: Command, ctx: CliContext): void => {
    program
      .command('start')
      .description('Run the dashboard server in the foreground (Ctrl+C stops)')
      .option('--port <n>', 'preferred port (falls back to a free one if taken)')
      .action(async (opts: { port?: string }) => {
        const env = ctx.io.env as NodeJS.ProcessEnv;
        let port: number | undefined;
        if (opts.port !== undefined) {
          port = Number(opts.port);
          if (!Number.isInteger(port) || port < 0 || port > 65535) throw new CliError(`invalid --port: ${opts.port}`, 2);
        }
        let uiDir: string;
        try {
          uiDir = deps.uiDir();
        } catch (err) {
          if (err instanceof NotBuiltError) throw new CliError(err.message, 1);
          throw err;
        }
        let stop: () => void = () => {};
        const stopped = new Promise<void>((r) => (stop = r));
        const result: ForegroundResult = await deps.runForeground({
          env,
          uiDir,
          ...(port !== undefined ? { port } : {}),
          logger: { info: () => {}, warn: (m) => ctx.io.stderr(`${m}\n`) },
          onShutdown: () => stop(),
        });
        if (!result.started) {
          throw new CliError(`already running at ${result.url} (pid ${result.pid}); stop it with: crontick-dashboard daemon stop`, 1);
        }
        const dispose = deps.onSignal(() => stop());
        ctx.io.stdout(`crontick-dashboard running at ${result.server.url}\n`);
        ctx.io.stdout(`Feed dir: ${feedDir(env)}\n`);
        ctx.io.stdout('Press Ctrl+C to stop\n');
        await stopped;
        dispose();
        await result.server.stop();
      });
  };
}

export const registerStart = createStartRegister();
