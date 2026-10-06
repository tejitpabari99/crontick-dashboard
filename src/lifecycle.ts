/**
 * Process lifecycle for the dashboard server (mirrors crontick daemon/lifecycle.ts + ensure.ts).
 * 06's CLI calls these: runForeground (`start`), daemonStart/daemonStop/daemonStatus (`daemon ...`).
 * State lives in <data>/daemon.pid (written by the server process), daemon.port, daemon.log, daemon.lock.
 */
import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { realClock, type Clock } from './clock.js';
import { APP_NAME } from './constants/app.js';
import { MUTATION_HEADER, MUTATION_HEADER_VALUE, JSON_CONTENT_TYPE } from './constants/http.js';
import {
  LIFECYCLE_POLL_MS,
  LOCK_STALE_MS,
  SHUTDOWN_REQUEST_TIMEOUT_MS,
  STARTUP_TIMEOUT_MS,
  STOP_TIMEOUT_MS,
} from './constants/lifecycle.js';
import { probeHealth } from './http/bind-port.js';
import { startServer, type RunningServer, type ServerLogger, type StartServerOptions } from './http/server.js';
import { isPidAlive, readPidFile, readPortFile } from './pid.js';
import { dataDir as dataDirOf, ensureDirs, lockFilePath, logFilePath, pidFilePath, portFilePath } from './paths.js';
import { ERROR_CODES } from './constants/error-codes.js';
import { AppError, errnoCode, notBuiltError } from './utils/errors.js';
import { loopbackHost, loopbackUrl } from './utils/loopback.js';
import { sleep as realSleep } from './utils/sleep.js';

type Env = NodeJS.ProcessEnv;

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  port?: number;
  url?: string;
  dataDir: string;
  /** True when leftover pid/port files from a dead or foreign process were found (and removed). */
  stale?: boolean;
  /** Pid is alive but /api/health did not answer as this server (busy or wedged); files are kept. */
  unhealthy?: boolean;
}

export interface DaemonOptions {
  env?: Env;
  /** Time source for deadlines and lock staleness (default real clock). */
  clock?: Clock;
  /** Delay between polls (default real sleep). */
  sleep?: (ms: number) => Promise<void>;
}

/** The subset of a child process `daemonStart` uses. */
export interface SpawnedChild {
  pid?: number | undefined;
  on(event: 'exit', fn: (code: number | null) => void): unknown;
  unref(): void;
}
export type SpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => SpawnedChild;

interface Timing {
  clock: Clock;
  sleep: (ms: number) => Promise<void>;
}
const timingOf = (o: DaemonOptions): Timing => ({ clock: o.clock ?? realClock, sleep: o.sleep ?? realSleep });

export interface DaemonStartOptions extends DaemonOptions {
  /** Built server entry to spawn (the CLI passes `<package root>/dist/server/index.js`). */
  serverEntry: string;
  /** Extra node args before the entry (tests: ['--import', 'tsx']). */
  nodeArgs?: string[];
  startupTimeoutMs?: number;
  /** Process spawner (default node:child_process spawn). */
  spawn?: SpawnFn;
}

export interface DaemonStartResult {
  alreadyRunning: boolean;
  pid: number;
  port: number;
  url: string;
  dataDir: string;
  logPath: string;
}

export interface DaemonStopOptions extends DaemonOptions {
  stopTimeoutMs?: number;
}

export interface DaemonStopResult {
  running: boolean;
  stopped: boolean;
  pid?: number;
  mode: 'already-stopped' | 'graceful' | 'hard-kill';
}

/** pid+port files, verified against /api/health. Cleans stale files. */
export async function daemonStatus(opts: DaemonOptions = {}): Promise<DaemonStatus> {
  const env = opts.env ?? process.env;
  const dataDir = dataDirOf(env);
  const pid = readPidFile(env);
  const port = readPortFile(env);
  const hadFiles = existsSync(pidFilePath(env)) || existsSync(portFilePath(env));
  if (pid !== undefined && port !== undefined && isPidAlive(pid)) {
    const h = await healthOf(port);
    if (h && (h.pid === undefined || h.pid === pid)) {
      return { running: true, pid, port, url: loopbackUrl(port), dataDir };
    }
  }
  if (pid !== undefined && isPidAlive(pid)) {
    // Live pid: never remove its files (a second server could then start on the same data dir).
    // Port file but no healthy answer => busy/unhealthy server, still running. No port file => still starting.
    if (port === undefined) return { running: false, dataDir };
    return { running: true, pid, port, url: loopbackUrl(port), dataDir, unhealthy: true };
  }
  rmSync(pidFilePath(env), { force: true });
  rmSync(portFilePath(env), { force: true });
  return hadFiles ? { running: false, dataDir, stale: true } : { running: false, dataDir };
}

async function healthOf(port: number): Promise<{ pid?: number } | undefined> {
  const occ = await probeHealth(port);
  if (occ.kind !== APP_NAME) return undefined;
  return occ.pid === undefined ? {} : { pid: occ.pid };
}

export type ForegroundResult = { started: true; server: RunningServer } | { started: false; url: string; pid: number };

/** `start`: run the server in this process. Refuses (returning the owner's URL) if a healthy server owns the data dir. */
export async function runForeground(
  opts: DaemonOptions & { uiDir: string; logger?: ServerLogger; onShutdown?: () => void; port?: number },
): Promise<ForegroundResult> {
  const env = opts.env ?? process.env;
  const st = await daemonStatus({ env });
  if (st.running && st.url !== undefined && st.pid !== undefined) return { started: false, url: st.url, pid: st.pid };
  const o: StartServerOptions = { env, uiDir: opts.uiDir };
  if (opts.logger) o.logger = opts.logger;
  if (opts.onShutdown) o.onShutdown = opts.onShutdown;
  if (opts.port !== undefined) o.port = opts.port;
  return { started: true, server: await startServer(o) };
}

/** `daemon start`: idempotent detached start; serialized by an exclusive daemon.lock. */
export async function daemonStart(opts: DaemonStartOptions): Promise<DaemonStartResult> {
  const env = opts.env ?? process.env;
  const timeoutMs = opts.startupTimeoutMs ?? STARTUP_TIMEOUT_MS;
  const t = timingOf(opts);
  const spawn: SpawnFn = opts.spawn ?? nodeSpawn;
  const serverEntry = opts.serverEntry;
  const logPath = logFilePath(env);
  const dataDir = dataDirOf(env);
  ensureDirs(env);

  const existing = await daemonStatus({ env });
  if (existing.running) return toStartResult(existing, true, logPath);

  if (!existsSync(serverEntry)) {
    throw notBuiltError('server entry', serverEntry);
  }

  const deadline = t.clock.now().getTime() + timeoutMs;
  const lock = lockFilePath(env);
  await acquireLock(lock, deadline, t);
  try {
    const again = await daemonStatus({ env }); // another starter may have won while we waited
    if (again.running) return toStartResult(again, true, logPath);

    const logFd = openSync(logPath, 'a');
    let exited: number | null | undefined;
    let child: SpawnedChild;
    try {
      child = spawn(process.execPath, [...(opts.nodeArgs ?? []), serverEntry], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        shell: false,
        windowsHide: true,
        env: { ...process.env, ...env },
      });
    } finally {
      closeSync(logFd);
    }
    child.on('exit', (code) => (exited = code));
    child.unref();

    while (t.clock.now().getTime() < deadline) {
      const st = await daemonStatus({ env });
      if (st.running) return toStartResult(st, false, logPath);
      if (exited !== undefined) {
        // Lost a race against a server that started outside the lock (e.g. foreground `start`)?
        const raced = await daemonStatus({ env });
        if (raced.running) return toStartResult(raced, true, logPath);
        throw new AppError(
          ERROR_CODES.DAEMON_START_FAILED,
          `daemon exited during startup (code ${String(exited)}); see log: ${logPath}`,
        );
      }
      await t.sleep(LIFECYCLE_POLL_MS);
    }
    try {
      if (child.pid !== undefined) process.kill(child.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
    throw new AppError(
      ERROR_CODES.DAEMON_START_TIMEOUT,
      `timed out after ${timeoutMs}ms waiting for daemon on ${dataDir}; see log: ${logPath}`,
    );
  } finally {
    releaseLock(lock);
  }
}

function toStartResult(st: DaemonStatus, alreadyRunning: boolean, logPath: string): DaemonStartResult {
  return { alreadyRunning, pid: st.pid ?? 0, port: st.port ?? 0, url: st.url ?? '', dataDir: st.dataDir, logPath };
}

/** `daemon stop`: POST /api/shutdown, then SIGTERM / SIGKILL after the timeout. Not running = success. */
export async function daemonStop(opts: DaemonStopOptions = {}): Promise<DaemonStopResult> {
  const env = opts.env ?? process.env;
  const timeoutMs = opts.stopTimeoutMs ?? STOP_TIMEOUT_MS;
  const t = timingOf(opts);
  const st = await daemonStatus({ env });
  if (!st.running || st.pid === undefined || st.port === undefined) {
    return { running: false, stopped: false, mode: 'already-stopped' };
  }
  const { pid, port } = st;
  const host = loopbackHost(port);
  let accepted = false;
  try {
    const res = await fetch(`http://${host}/api/shutdown`, {
      method: 'POST',
      headers: { Host: host, 'Content-Type': JSON_CONTENT_TYPE, [MUTATION_HEADER]: MUTATION_HEADER_VALUE },
      body: '{}',
      signal: AbortSignal.timeout(SHUTDOWN_REQUEST_TIMEOUT_MS),
    });
    accepted = res.ok;
  } catch {
    /* fall through to signals */
  }
  let mode: DaemonStopResult['mode'] = 'graceful';
  if (!(accepted && (await waitDead(pid, timeoutMs, t)))) {
    mode = 'hard-kill';
    if (!(await killAndWait(pid, 'SIGTERM', timeoutMs, t))) await killAndWait(pid, 'SIGKILL', timeoutMs, t);
  }
  const dead = !isPidAlive(pid);
  if (dead) {
    rmSync(pidFilePath(env), { force: true });
    rmSync(portFilePath(env), { force: true });
  }
  return { running: !dead, stopped: dead, pid, mode };
}

async function waitDead(pid: number, timeoutMs: number, t: Timing): Promise<boolean> {
  const deadline = t.clock.now().getTime() + timeoutMs;
  while (t.clock.now().getTime() < deadline) {
    if (!isPidAlive(pid)) return true;
    await t.sleep(LIFECYCLE_POLL_MS);
  }
  return !isPidAlive(pid);
}

async function killAndWait(pid: number, sig: NodeJS.Signals, timeoutMs: number, t: Timing): Promise<boolean> {
  try {
    process.kill(pid, sig);
  } catch {
    return true;
  }
  return waitDead(pid, timeoutMs, t);
}

async function acquireLock(path: string, deadline: number, t: Timing): Promise<void> {
  for (;;) {
    try {
      const fd = openSync(path, 'wx');
      writeSync(fd, JSON.stringify({ pid: process.pid, at: t.clock.now().getTime() }));
      closeSync(fd);
      return;
    } catch (err) {
      if (errnoCode(err) !== 'EEXIST') throw err;
    }
    removeIfStale(path, t.clock.now().getTime());
    if (t.clock.now().getTime() >= deadline) throw new AppError(ERROR_CODES.LOCK_TIMEOUT, `timed out waiting for ${path}; remove it if no daemon start is running`);
    await t.sleep(LIFECYCLE_POLL_MS);
  }
}

function removeIfStale(path: string, nowMs: number): void {
  try {
    const l = JSON.parse(readFileSync(path, 'utf8')) as { pid?: number; at?: number };
    const dead = typeof l.pid !== 'number' || !isPidAlive(l.pid);
    const old = typeof l.at !== 'number' || nowMs - l.at > LOCK_STALE_MS;
    if (dead || old) rmSync(path, { force: true });
  } catch {
    // unreadable/partially written: only remove when old by mtime is unknowable here; retry next poll
  }
}

function releaseLock(path: string): void {
  rmSync(path, { force: true });
}
