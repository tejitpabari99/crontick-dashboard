/** startServer: wires data dir, state, feed, events and the HTTP listener. */
import { getRequestListener } from '@hono/node-server';
import { rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Clock, realClock } from '../clock.js';
import { type ConfigReader, createConfigReader, resolvePort } from '../config.js';
import { LOOPBACK_HOST } from '../constants/http.js';
import { RECONCILE_INTERVAL_MS } from '../constants/state.js';
import { createCardEvents, type CardEvents } from '../feed/events.js';
import { createFeedWatcher } from '../feed/watcher.js';
import { syncSchemas as realSyncSchemas, type SchemaSyncResult } from '../schemas-sync.js';
import { dataDir as dataDirOf, doneDir, ensureDirs, feedDir, portFilePath } from '../paths.js';
import { claimPidFile, releasePidFile } from '../pid.js';
import { errorMessage } from '../utils/errors.js';
import { loopbackUrl } from '../utils/loopback.js';
import { realTimers, type IntervalTimers } from '../utils/timers.js';
import { createStateStore } from '../state/store.js';
import { createWarnings, type Warnings } from '../state/warnings.js';
import type { ActionDeps } from '../actions/registry.js';
import { createApp } from './app.js';
import { bindPort, probeHealth } from './bind-port.js';
import { assertUiBuilt } from './static.js';
import {
  createNodeNotifierAdapter,
  createNotifier,
  createNotifyGate,
  type Notifier,
  type NotifyAdapter,
} from '../integrations/notify/index.js';

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
  /** OS notification adapter (default: real node-notifier adapter, created lazily on first delivery). */
  notifyAdapter?: NotifyAdapter;
  /** Schema sync run once at startup (default `syncSchemas`); failures are logged, never fatal. */
  syncSchemas?: (env: NodeJS.ProcessEnv) => SchemaSyncResult;
  /** Timer source for the state-reconcile interval (default real timers). */
  timers?: IntervalTimers;
  /** Platform used by the notification gate (default process.platform). Mainly for tests. */
  notifyPlatform?: NodeJS.Platform;
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
  /** OS notification state (`status()` for 06 `info`). */
  notifier: Notifier;
  address(): AddressInfo;
}

const nullLogger: ServerLogger = { info: () => {}, warn: () => {} };

export async function startServer(opts: StartServerOptions): Promise<RunningServer> {
  const env = opts.env ?? process.env;
  const clock = opts.clock ?? realClock;
  const logger = opts.logger ?? nullLogger;
  assertUiBuilt(opts.uiDir);

  ensureDirs(env);
  try {
    const sync = (opts.syncSchemas ?? ((e) => realSyncSchemas(e)))(env);
    for (const w of sync.warnings) logger.warn(w);
  } catch (err) {
    logger.warn(`schema sync failed: ${errorMessage(err)}`);
  }
  await claimPidFile(env);
  const dataDir = dataDirOf(env);
  const config = createConfigReader(env);
  const state = createStateStore({ env, clock });
  const warnings = createWarnings();
  const events = createCardEvents({ state, clock, getTimezone: () => config.get().config.timezone, warnings });

  // Notifier subscribes here, before watcher.start(), so startup-scan events reach it.
  let boundPort = 0;
  let realAdapter: NotifyAdapter | undefined;
  const notifyAdapter: NotifyAdapter =
    opts.notifyAdapter ?? {
      notify: (payload) => (realAdapter ??= createNodeNotifierAdapter()).notify(payload),
    };
  const notifier = createNotifier({
    events: events.events,
    adapter: notifyAdapter,
    getPort: () => boundPort,
    getThreshold: () => config.get().config.nowPriorityThreshold,
    warnings,
    logger,
    gate: createNotifyGate({
      getConfigValue: () => config.get().config.notifications.os,
      env,
      platform: opts.notifyPlatform ?? process.platform,
    }),
  });

  const watcher = createFeedWatcher({ feedDir: feedDir(env), clock, onChange: events.onChange });

  const timers = opts.timers ?? realTimers;
  let reconcileTimer: unknown;
  /** In-flight state reconciles; stop() awaits them so nothing writes after it resolves. */
  const reconciles = new Set<Promise<void>>();
  const reconcileState = (): void => {
    const present = new Set<string>();
    const current = new Map<string, string>();
    for (const e of watcher.store.list()) {
      present.add(e.key); // a no-data or temporarily broken card keeps its owner state
      if (e.status === 'ok') current.set(e.key, e.dataVersion);
    }
    for (const a of watcher.alerts.list()) present.add(`alert:${a.key}`); // alert owner state (notified/lastSeen)
    if (stopped) return;
    const p: Promise<void> = state
      .reconcile(present, current)
      .catch((err: unknown) => logger.warn(`state reconcile failed: ${errorMessage(err)}`))
      .finally(() => reconciles.delete(p));
    reconciles.add(p);
  };

  let stopped: Promise<void> | undefined;
  const server: Server = createServer();

  const stop = (): Promise<void> => {
    stopped ??= (async () => {
      if (reconcileTimer !== undefined) timers.clearInterval(reconcileTimer);
      notifier.dispose();
      watcher.stop();
      await events.flush().catch(() => {});
      await Promise.allSettled([...reconciles]);
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
    alerts: watcher.alerts,
    completedAlerts: watcher.completedAlerts,
    warnings,
    dataDir,
    feedDir: feedDir(env),
    doneDir: doneDir(env),
    issues: () => watcher.issues(),
    refreshFeed: (ref) => {
      if (ref.kind === 'card') watcher.processFolder(ref.id);
      else {
        watcher.processAlert(`${ref.id}.json`);
        watcher.processCompletedAlert(`${ref.id}.json`);
      }
    },
    selfWrites: watcher.selfWrites,
    ...(opts.actionTestDeps ? { actionTestDeps: opts.actionTestDeps } : {}),
    uiDir: opts.uiDir,
    getPort: () => boundPort,
    log: (m) => logger.warn(m),
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
          srv.listen(port, LOOPBACK_HOST, () => {
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
    reconcileState();
    reconcileTimer = timers.setInterval(reconcileState, RECONCILE_INTERVAL_MS);
  } catch (err) {
    await stop();
    throw err;
  }

  logger.info(`crontick-dashboard listening on ${loopbackUrl(boundPort)}`);
  return {
    url: loopbackUrl(boundPort),
    port: boundPort,
    dataDir,
    stop,
    events: events.events,
    warnings,
    config,
    notifier,
    address: () => srv.address() as AddressInfo,
  };
}
