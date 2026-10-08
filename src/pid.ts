/** pid file helpers: one server per data dir, enforced by a pid file the server process writes itself. */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { APP_NAME } from './constants/app.js';
import { probeHealth } from './http/bind-port.js';
import { pidFilePath, portFilePath } from './paths.js';
import { ERROR_CODES } from './constants/error-codes.js';
import { AppError, errnoCode } from './utils/errors.js';
import { parsePort } from './utils/port.js';

type Env = NodeJS.ProcessEnv;

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return errnoCode(err) === 'EPERM'; // exists, not ours
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
    return parsePort(readFileSync(portFilePath(env), 'utf8').trim());
  } catch {
    return undefined;
  }
}

/**
 * Called by the server process before binding. Throws AppError ALREADY_RUNNING if another live server owns the
 * data dir; a dead pid (or a live pid whose recorded port answers as something else, i.e. pid reuse)
 * is stale and taken over. Then writes our own pid.
 */
export async function claimPidFile(env: Env = process.env): Promise<void> {
  const other = readPidFile(env);
  if (other !== undefined && other !== process.pid && isPidAlive(other)) {
    const port = readPortFile(env);
    const occ = port === undefined ? undefined : await probeHealth(port);
    if (port === undefined || occ?.kind === APP_NAME) {
      throw new AppError(
        ERROR_CODES.ALREADY_RUNNING,
        `a ${APP_NAME} server (pid ${other}) already owns this data dir; run \`${APP_NAME} daemon status\` or \`${APP_NAME} daemon stop\``,
      );
    }
  }
  writeFileSync(pidFilePath(env), `${process.pid}\n`);
}

/** Removes the pid file only if it still names this process. */
export function releasePidFile(env: Env = process.env): void {
  if (readPidFile(env) === process.pid) rmSync(pidFilePath(env), { force: true });
}
