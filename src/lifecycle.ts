/**
 * Process lifecycle for the dashboard server (mirrors crontick daemon/lifecycle.ts + ensure.ts).
 * 06's CLI calls these: runForeground (`start`), daemonStart/daemonStop/daemonStatus (`daemon ...`).
 * State lives in <data>/daemon.pid (written by the server process), daemon.port, daemon.log, daemon.lock.
 */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeHealth } from './http/bind-port.js';
import { startServer, type RunningServer, type ServerLogger, type StartServerOptions } from './http/server.js';
import { isPidAlive, readPidFile, readPortFile } from './pid.js';
import { dataDir as dataDirOf, ensureDirs, lockFilePath, logFilePath, pidFilePath, portFilePath } from './paths.js';

type Env = NodeJS.ProcessEnv;

const POLL_MS = 50;
const LOCK_STALE_MS = 60_000;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Production default: dist/server/index.js next to the built lifecycle module (dist/lifecycle.js). */
export const defaultServerEntry = (): string => resolve(dirname(fileURLToPath(import.meta.url)), 'server/index.js');

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
}

export interface DaemonStartOptions extends DaemonOptions {
  /** Server entry to spawn. Default: dist/server/index.js relative to this module. */
  serverEntry?: string;
  /** Extra node args before the entry (tests: ['--import', 'tsx']). */
  nodeArgs?: string[];
  startupTimeoutMs?: number;
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
      return { running: true, pid, port, url: `http://127.0.0.1:${port}`, dataDir };
    }
  }
  if (pid !== undefined && isPidAlive(pid)) {
    // Live pid: never remove its files (a second server could then start on the same data dir).
    // Port file but no healthy answer => busy/unhealthy server, still running. No port file => still starting.
    if (port === undefined) return { running: false, dataDir };
    return { running: true, pid, port, url: `http://127.0.0.1:${port}`, dataDir, unhealthy: true };
  }
  rmSync(pidFilePath(env), { force: true });
  rmSync(portFilePath(env), { force: true });
  return hadFiles ? { running: false, dataDir, stale: true } : { running: false, dataDir };
}

async function healthOf(port: number): Promise<{ pid?: number } | undefined> {
  const occ = await probeHealth(port);
  if (occ.kind !== 'crontick-dashboard') return undefined;
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
export async function daemonStart(opts: DaemonStartOptions = {}): Promise<DaemonStartResult> {
  const env = opts.env ?? process.env;
  const timeoutMs = opts.startupTimeoutMs ?? 15_000;
  const serverEntry = opts.serverEntry ?? defaultServerEntry();
  const logPath = logFilePath(env);
  const dataDir = dataDirOf(env);
  ensureDirs(env);

  const existing = await daemonStatus({ env });
  if (existing.running) return toStartResult(existing, true, logPath);

  if (!existsSync(serverEntry)) {
    throw new Error(`NOT_BUILT: server entry not found at ${serverEntry} (run npm run build)`);
  }

  const deadline = Date.now() + timeoutMs;
  const lock = lockFilePath(env);
  await acquireLock(lock, deadline);
  try {
    const again = await daemonStatus({ env }); // another starter may have won while we waited
    if (again.running) return toStartResult(again, true, logPath);

    const logFd = openSync(logPath, 'a');
    let exited: number | null | undefined;
    let child;
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

    while (Date.now() < deadline) {
      const st = await daemonStatus({ env });
      if (st.running) return toStartResult(st, false, logPath);
      if (exited !== undefined) {
        // Lost a race against a server that started outside the lock (e.g. foreground `start`)?
        const raced = await daemonStatus({ env });
        if (raced.running) return toStartResult(raced, true, logPath);
        throw new Error(`daemon exited during startup (code ${String(exited)}); see log: ${logPath}`);
      }
      await sleep(POLL_MS);
    }
    try {
      if (child.pid !== undefined) process.kill(child.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
    throw new Error(`timed out after ${timeoutMs}ms waiting for daemon on ${dataDir}; see log: ${logPath}`);
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
  const timeoutMs = opts.stopTimeoutMs ?? 5_000;
  const st = await daemonStatus({ env });
  if (!st.running || st.pid === undefined || st.port === undefined) {
    return { running: false, stopped: false, mode: 'already-stopped' };
  }
  const { pid, port } = st;
  const host = `127.0.0.1:${port}`;
  let accepted = false;
  try {
    const res = await fetch(`http://${host}/api/shutdown`, {
      method: 'POST',
      headers: { Host: host, 'Content-Type': 'application/json', 'X-Crontick-Dashboard': '1' },
      body: '{}',
      signal: AbortSignal.timeout(2_000),
    });
    accepted = res.ok;
  } catch {
    /* fall through to signals */
  }
  let mode: DaemonStopResult['mode'] = 'graceful';
  if (!(accepted && (await waitDead(pid, timeoutMs)))) {
    mode = 'hard-kill';
    if (!(await killAndWait(pid, 'SIGTERM', timeoutMs))) await killAndWait(pid, 'SIGKILL', timeoutMs);
  }
  const dead = !isPidAlive(pid);
  if (dead) {
    rmSync(pidFilePath(env), { force: true });
    rmSync(portFilePath(env), { force: true });
  }
  return { running: !dead, stopped: dead, pid, mode };
}

async function waitDead(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await sleep(POLL_MS);
  }
  return !isPidAlive(pid);
}

async function killAndWait(pid: number, sig: NodeJS.Signals, timeoutMs: number): Promise<boolean> {
  try {
    process.kill(pid, sig);
  } catch {
    return true;
  }
  return waitDead(pid, timeoutMs);
}

async function acquireLock(path: string, deadline: number): Promise<void> {
  for (;;) {
    try {
      const fd = openSync(path, 'wx');
      writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
      closeSync(fd);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    removeIfStale(path);
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}; remove it if no daemon start is running`);
    await sleep(POLL_MS);
  }
}

function removeIfStale(path: string): void {
  try {
    const l = JSON.parse(readFileSync(path, 'utf8')) as { pid?: number; at?: number };
    const dead = typeof l.pid !== 'number' || !isPidAlive(l.pid);
    const old = typeof l.at !== 'number' || Date.now() - l.at > LOCK_STALE_MS;
    if (dead || old) rmSync(path, { force: true });
  } catch {
    // unreadable/partially written: only remove when old by mtime is unknowable here; retry next poll
  }
}

function releaseLock(path: string): void {
  rmSync(path, { force: true });
}
