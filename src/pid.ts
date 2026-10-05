/** pid file helpers: one server per data dir, enforced by a pid file the server process writes itself. */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { probeHealth } from './http/bind-port.js';
import { pidFilePath, portFilePath } from './paths.js';

type Env = NodeJS.ProcessEnv;

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'; // exists, not ours
  }
}

export function readPidFile(env: Env = process.env): number | undefined {
  try {
    const n = Number.parseInt(readFileSync(pidFilePath(env), 'utf8').trim(), 10);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

export function readPortFile(env: Env = process.env): number | undefined {
  try {
    const n = Number.parseInt(readFileSync(portFilePath(env), 'utf8').trim(), 10);
    return Number.isInteger(n) && n > 0 && n <= 65535 ? n : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Called by the server process before binding. Throws ALREADY_RUNNING if another live server owns the
 * data dir; a dead pid (or a live pid whose recorded port answers as something else, i.e. pid reuse)
 * is stale and taken over. Then writes our own pid.
 */
export async function claimPidFile(env: Env = process.env): Promise<void> {
  const other = readPidFile(env);
  if (other !== undefined && other !== process.pid && isPidAlive(other)) {
    const port = readPortFile(env);
    const occ = port === undefined ? undefined : await probeHealth(port);
    if (port === undefined || occ?.kind === 'crontick-dashboard') {
      throw new Error(`ALREADY_RUNNING: a crontick-dashboard server (pid ${other}) already owns this data dir`);
    }
  }
  writeFileSync(pidFilePath(env), `${process.pid}\n`);
}

/** Removes the pid file only if it still names this process. */
export function releasePidFile(env: Env = process.env): void {
  if (readPidFile(env) === process.pid) rmSync(pidFilePath(env), { force: true });
}
