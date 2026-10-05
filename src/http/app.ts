/** Hono app: security envelope + read routes. Mutation routes (Tasks 8/9) attach in `mountMutations`. */
import { Hono } from 'hono';
import type { ActionDeps } from '../actions/registry.js';
import type { Clock } from '../clock.js';
import type { ConfigReader } from '../config.js';
import { computeSnapshot } from '../compute/snapshot.js';
import type { CardStore } from '../feed/ingest.js';
import type { StateStore } from '../state/store.js';
import type { Warnings } from '../state/warnings.js';
import type { Snapshot } from '../shared/api-types.js';
import { hostGuard, mutationGuard } from './guards.js';
import { mountActions } from './actions.js';
import { mountMutations } from './mutations.js';
import { serveStatic } from './static.js';

export interface AppContext {
  clock: Clock;
  config: ConfigReader;
  state: StateStore;
  cards: CardStore;
  warnings: Warnings;
  dataDir: string;
  feedDir: string;
  doneDir: string;
  /** Re-ingest one feed file synchronously (after server-side moves/writes). */
  refreshFeed: (file: string) => void;
  /** Watcher self-write registry (file -> hash of bytes the server wrote). */
  selfWrites: Map<string, string>;
  /** Test seams for write-back. */
  actionTestDeps?: Pick<ActionDeps, 'rename' | 'sleep' | 'hooks'>;
  uiDir: string;
  getPort: () => number;
  /** POST /api/shutdown: called after the response is queued. */
  requestShutdown: () => void;
}

export function buildSnapshot(ctx: AppContext): Snapshot {
  const { config, warnings: cfgWarnings } = ctx.config.get();
  return computeSnapshot(
    ctx.cards.list(),
    ctx.state.get(),
    config,
    ctx.clock.now(),
    [...ctx.state.warnings, ...ctx.warnings.list(), ...cfgWarnings],
  );
}

const etagMatches = (header: string | undefined, etag: string): boolean =>
  header !== undefined &&
  header
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === etag || t === '*');

export function createApp(ctx: AppContext): Hono {
  const app = new Hono();
  app.use('*', hostGuard(ctx.getPort));

  app.get('/api/health', (c) => c.json({ app: 'crontick-dashboard', pid: process.pid, dataDir: ctx.dataDir }));

  app.get('/api/snapshot', (c) => {
    const snap = buildSnapshot(ctx);
    const etag = `"${snap.rev}"`;
    if (etagMatches(c.req.header('if-none-match'), etag)) return c.body(null, 304, { ETag: etag });
    return c.json(snap, 200, { ETag: etag, 'Cache-Control': 'no-cache' });
  });

  // Every non-GET /api route goes through the mutation guard.
  app.use('/api/*', mutationGuard);

  app.post('/api/shutdown', (c) => {
    setImmediate(ctx.requestShutdown);
    return c.json({ ok: true });
  });

  mountMutations(app, ctx);
  mountActions(app, ctx);

  app.all('*', serveStatic(ctx.uiDir));
  return app;
}
