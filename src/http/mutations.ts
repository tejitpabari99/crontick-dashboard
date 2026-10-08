/** Owner-click mutation routes: alert tick, Done ack, hide. Ids are resolved via the CardStore only. */
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Context, Hono } from 'hono';
import { ERROR_CODES } from '../constants/error-codes.js';
import { moveToDone } from '../feed/done.js';
import { apiError, internalError } from './errors.js';
import type { AppContext } from './app.js';
import { buildSnapshot } from './app.js';

export function mountMutations(app: Hono, ctx: AppContext): void {
  const ok = (c: Context) => c.json({ rev: buildSnapshot(ctx).rev });
  const fail = (c: Context, err: unknown) => internalError(c, err, ctx.log);
  const notFound = (c: Context) => apiError(c, 404, ERROR_CODES.CARD_NOT_FOUND, 'no card with that id; reload the page');

  const alertNotFound = (c: Context) => apiError(c, 404, ERROR_CODES.CARD_NOT_FOUND, 'no alert with that id; reload the page');
  /** Alert ids are file stems: a single path segment, no leading dot, no `:`. Anything else cannot be an alert. */
  const validStem = (id: string): boolean => id !== '' && !id.startsWith('.') && !/[\\/:\0]/.test(id) && !/\.tmp$/i.test(id);

  app.post('/api/alerts/:id/tick', async (c) => {
    const id = c.req.param('id');
    const file = `${id}.json`;
    if (!validStem(id)) return alertNotFound(c);
    const alertsDir = dirname(ctx.doneDir);
    if (!existsSync(join(alertsDir, file))) {
      if (existsSync(join(ctx.doneDir, file)) || ctx.completedAlerts.get(id)) return ok(c); // already ticked
      return ctx.cards.get(id) ? apiError(c, 400, ERROR_CODES.NOT_AN_ALERT, 'card is not an alert') : alertNotFound(c);
    }
    try {
      const now = ctx.clock.now();
      const landed = await moveToDone({ feedDir: alertsDir, doneDir: ctx.doneDir, file, clock: ctx.clock, touchAt: now });
      ctx.refreshFeed({ kind: 'alert', id });
      if (landed !== undefined && landed !== file) ctx.refreshFeed({ kind: 'alert', id: basename(landed, '.json') });
    } catch (err) {
      return fail(c, err);
    }
    return ok(c);
  });

  app.post('/api/cards/:id/done', async (c) => {
    const entry = ctx.cards.get(c.req.param('id'));
    if (!entry) return notFound(c);
    if (entry.status !== 'ok') return apiError(c, 400, ERROR_CODES.CARD_BROKEN, 'card is broken; fix the card file');
    try {
      await ctx.state.markDone(entry.key, entry.dataVersion, ctx.clock.now().toISOString());
    } catch (err) {
      return fail(c, err);
    }
    return ok(c);
  });

  app.delete('/api/cards/:id/done', async (c) => {
    const id = c.req.param('id');
    if (!ctx.cards.get(id)) return notFound(c);
    try {
      await ctx.state.unack(id);
    } catch (err) {
      return fail(c, err);
    }
    return ok(c);
  });

  for (const [method, hidden] of [['put', true], ['delete', false]] as const) {
    app[method]('/api/cards/:id/hidden', async (c) => {
      const id = c.req.param('id');
      if (!ctx.cards.get(id)) return notFound(c);
      try {
        await ctx.state.hide(id, hidden);
      } catch (err) {
        return fail(c, err);
      }
      return ok(c);
    });
  }
}
