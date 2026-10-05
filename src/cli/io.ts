/** Injectable process surface so the CLI is testable without spawning. */
export interface CliIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  readStdin: () => Promise<string>;
  env: Record<string, string | undefined>;
  /** true when stderr is a TTY (enables red). */
  isTTY: boolean;
}

export const processIo = (): CliIo => ({
  stdout: (s) => void process.stdout.write(s),
  stderr: (s) => void process.stderr.write(s),
  readStdin: async () => {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  },
  env: process.env,
  isTTY: Boolean(process.stderr.isTTY),
});

/** Thrown by commands to end with a one-line error and a specific exit code (2 = usage/IO). */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

/** Per-run context handed to every command's register function. */
export interface CliContext {
  io: CliIo;
  /** Commands set this instead of calling process.exit; `run` returns it. */
  setExitCode: (code: number) => void;
  verbose: () => boolean;
}
