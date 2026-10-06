/**
 * CLI program (loaded by index.ts after the Node guard). `run(argv, io)` is the testable core:
 * it never calls process.exit and returns the exit code. Commands live in ./commands/<name>.ts and
 * export a `registerX(program, ctx)`; add new ones to COMMANDS below.
 */
import { Command, CommanderError } from 'commander';
import { APP_NAME } from '../constants/app.js';
import { ENV_VERBOSE } from '../constants/env.js';
import { packageVersion } from './assets.js';
import { CliError, processIo, type CliContext, type CliIo } from './io.js';
import { registerValidate } from './commands/validate.js';
import { registerTemplates } from './commands/templates.js';
import { registerInfo } from './commands/info.js';
import { registerStart } from './commands/start.js';
import { registerDaemon } from './commands/daemon.js';
import { registerSkill } from './commands/skill.js';

export type { CliIo, CliContext } from './io.js';
export { CliError } from './io.js';

const COMMANDS: ((program: Command, ctx: CliContext) => void)[] = [registerValidate, registerTemplates, registerInfo, registerStart, registerDaemon, registerSkill];

export async function run(argv: string[], io: CliIo): Promise<number> {
  let code = 0;
  let verbose = false;
  const verboseEnv = (): boolean => !!io.env[ENV_VERBOSE] && io.env[ENV_VERBOSE] !== '0';
  const red = (s: string): string => (io.isTTY && !io.env.NO_COLOR ? `\x1b[31m${s}\x1b[0m` : s);
  const ctx: CliContext = { io, setExitCode: (c) => void (code = c), verbose: () => verbose || verboseEnv() };

  const program = new Command()
    .name(APP_NAME)
    .description('Local dashboard for agent-written cards')
    .version(packageVersion())
    .option('--verbose', 'print stack traces on error')
    .exitOverride()
    .configureOutput({ writeOut: (s) => io.stdout(s), writeErr: () => {} });
  for (const register of COMMANDS) register(program, ctx);
  program.hook('preAction', () => void (verbose = Boolean(program.opts().verbose)));

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.exitCode === 0) return 0;
      io.stderr(`${red(err.message.split('\n')[0] ?? 'error')}\n`);
      return 2;
    }
    if (err instanceof CliError) {
      io.stderr(`${red(err.message)}\n`);
      if (ctx.verbose() && err.code) io.stderr(`code: ${err.code}\n`);
      return err.exitCode;
    }
    const e = err instanceof Error ? err : new Error(String(err));
    io.stderr(`${red(`error: ${e.message}`)}\n`);
    if (ctx.verbose() && e.stack) io.stderr(`${e.stack}\n`);
    return 1;
  }
  return code;
}

/** Entry used by index.ts. Sets exitCode (no process.exit) so stdio drains. */
export async function main(): Promise<void> {
  process.exitCode = await run(process.argv.slice(2), processIo());
}
