/** startServer: wires data dir, state, feed, archive, events and the HTTP listener. */
import { getRequestListener } from '@hono/node-server';
import { rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Clock, realClock } from '../clock.js';
import { type ConfigReader, createConfigReader, resolvePort } from '../config.js';
import { createArchive } from '../feed/archive.js';
import { createCardEvents, type CardEvents } from '../feed/events.js';
import { envelope } from '../feed/ingest.js';
import { createFeedWatcher } from '../feed/watcher.js';
import { archiveDir, dataDir as dataDirOf, doneDir, ensureDirs, feedDir, portFilePath } from '../paths.js';
import { claimPidFile, releasePidFile } from '../pid.js';
import { createStateStore } from '../state/store.js';
import { createWarnings, type Warnings } from '../state/warnings.js';
import type { ActionDeps } from '../actions/registry.js';
import { createApp } from './app.js';
import { bindPort, probeHealth } from './bind-port.js';
import { assertUiBuilt } from './static.js';

export interface ServerLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface StartServerOptions {
  env?: NodeJS.ProcessEnv;
  clock?: Clock;
  /** Built UI directory (must contain index.html, else NOT_BUILT). */
  uiDir: string;
  logger?: ServerLogger;
  /** Override the port (0 = OS-assigned). Default: env > config > DEFAULT_PORT. Mainly for tests. */
  port?: number;
  /** Called after POST /api/shutdown finished stopping (server entry exits the process here). */
  onShutdown?: () => void;
  /** Test seams for complete write-back (rename/sleep/hooks). */
  actionTestDeps?: Pick<ActionDeps, 'rename' | 'sleep' | 'hooks'>;
}

export interface RunningServer {
  url: string;
  port: number;
  dataDir: string;
  stop(): Promise<void>;
  events: CardEvents;
  warnings: Warnings;
  /** Live config reader (`get().config`, mtime-based reload) for consumers such as 05-notifications. */
  config: ConfigReader;
  address(): AddressInfo;
}

const RECONCILE_INTERVAL_MS = 3_600_000;
const nullLogger: ServerLogger = { info: () => {}, warn: () => {} };

export async function startServer(opts: StartServerOptions): Promise<RunningServer> {
  const env = opts.env ?? process.env;
  const clock = opts.clock ?? realClock;
  const logger = opts.logger ?? nullLogger;
  assertUiBuilt(opts.uiDir);

  ensureDirs(env);
  await claimPidFile(env);
  const dataDir = dataDirOf(env);
  const config = createConfigReader(env);
  const state = createStateStore({ env, clock });
  const warnings = createWarnings();
  const events = createCardEvents({ state, clock, getTimezone: () => config.get().config.timezone, warnings });

  // eslint-disable-next-line prefer-const -- archive/watcher reference each other through closures
  let watcher: ReturnType<typeof createFeedWatcher>;
  const archive = createArchive({
    archiveDir: archiveDir(env),
    clock,
    retentionDefault: () => config.get().config.retentionDefault,
    cards: () => {
      const m = new Map<string, string | undefined>();
      for (const e of watcher.store.list()) {
        if (e.status === 'ok') m.set(e.key, envelope(e.card).retention);
      }
      return m;
    },
  });
  watcher = createFeedWatcher({ feedDir: feedDir(env), onIngest: archive.onIngest, onChange: events.onChange });

  let reconcileTimer: NodeJS.Timeout | undefined;
  const reconcileState = (): void => {
    const present = new Set<string>();
    for (const e of watcher.store.list()) {
      if (e.status === 'ok') present.add(e.key);
      else if (e.id !== undefined) present.add(e.id); // a temporarily broken card keeps its owner state
    }
    state.reconcile(present).catch((err: unknown) => logger.warn(`state reconcile failed: ${err instanceof Error ? err.message : String(err)}`));
  };

  let boundPort = 0;
  let stopped: Promise<void> | undefined;
  const server: Server = createServer();

  const stop = (): Promise<void> => {
    stopped ??= (async () => {
      if (reconcileTimer) clearInterval(reconcileTimer);
      watcher.stop();
      archive.stop();
      await events.flush().catch(() => {});
      if (server.listening) {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        });
      }
      rmSync(portFilePath(env), { force: true });
      releasePidFile(env);
    })();
    return stopped;
  };

  const app = createApp({
    clock,
    config,
    state,
    cards: watcher.store,
    warnings,
    dataDir,
    feedDir: feedDir(env),
    doneDir: doneDir(env),
    refreshFeed: (f) => watcher.processFile(f),
    selfWrites: watcher.selfWrites,
    ...(opts.actionTestDeps ? { actionTestDeps: opts.actionTestDeps } : {}),
    uiDir: opts.uiDir,
    getPort: () => boundPort,
    requestShutdown: () => void stop().then(() => opts.onShutdown?.()),
  });
  server.on('request', getRequestListener(app.fetch));
  const srv = server;

  const preferred = opts.port ?? resolvePort(config.get().config, env);
  try {
    const result = await bindPort(preferred, {
      listen: (port) =>
        new Promise<number>((resolve, reject) => {
          const onError = (err: Error): void => reject(err);
          srv.once('error', onError);
          srv.listen(port, '127.0.0.1', () => {
            srv.off('error', onError);
            resolve((srv.address() as AddressInfo).port);
          });
        }),
      probe: probeHealth,
      notify: (m) => logger.warn(m),
    });
    boundPort = result.port;
    writeFileSync(portFilePath(env), `${boundPort}\n`);
    watcher.start();
    archive.start();
    reconcileState();
    reconcileTimer = setInterval(reconcileState, RECONCILE_INTERVAL_MS);
    reconcileTimer.unref();
  } catch (err) {
    await stop();
    throw err;
  }

  logger.info(`crontick-dashboard listening on http://127.0.0.1:${boundPort}`);
  return {
    url: `http://127.0.0.1:${boundPort}`,
    port: boundPort,
    dataDir,
    stop,
    events: events.events,
    warnings,
    config,
    address: () => srv.address() as AddressInfo,
  };
}
