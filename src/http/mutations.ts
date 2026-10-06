/** Owner-click mutation routes: alert tick, Done ack, hide, layout. Ids are resolved via the CardStore only. */
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { moveToDone } from '../feed/done.js';
import { envelope } from '../feed/ingest.js';
import { ERROR_CODES } from '../constants/error-codes.js';
import { apiError, internalError } from './errors.js';
import type { AppContext } from './app.js';
import { buildSnapshot } from './app.js';

const LayoutSchema = z
  .array(z.object({ i: z.string(), x: z.number().finite(), y: z.number().finite(), w: z.number().finite(), h: z.number().finite() }))
  .max(10_000);

export function mountMutations(app: Hono, ctx: AppContext): void {
  const ok = (c: Context) => c.json({ rev: buildSnapshot(ctx).rev });
  const fail = (c: Context, err: unknown) => internalError(c, err, ctx.log);
  const notFound = (c: Context) => apiError(c, 404, ERROR_CODES.CARD_NOT_FOUND, 'no card with that id; reload the page');

  /** Ids this server already moved to done/: a repeated tick is an idempotent 200 (ids never reach the filesystem). */
  const ticked = new Set<string>();

  app.post('/api/alerts/:id/tick', async (c) => {
    const id = c.req.param('id');
    const entry = ctx.cards.get(id);
    if (!entry) return ticked.has(id) ? ok(c) : notFound(c);
    if (entry.status !== 'ok' || envelope(entry.card).kind !== 'alert') return apiError(c, 400, ERROR_CODES.NOT_AN_ALERT, 'card is not an alert');
    try {
      await moveToDone({ feedDir: ctx.feedDir, doneDir: ctx.doneDir, file: entry.file, clock: ctx.clock });
      ctx.refreshFeed(entry.file);
      ticked.add(id);
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
      await ctx.state.ack(entry.key, envelope(entry.card).updatedAt);
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

  app.put('/api/layout', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return apiError(c, 400, ERROR_CODES.INVALID_JSON, 'request body must be valid JSON');
    }
    const parsed = LayoutSchema.safeParse(body);
    if (!parsed.success) return apiError(c, 400, ERROR_CODES.INVALID_LAYOUT, 'body must be an array of { i, x, y, w, h }');
    try {
      await ctx.state.setLayout(parsed.data);
    } catch (err) {
      return fail(c, err);
    }
    return ok(c);
  });
}
