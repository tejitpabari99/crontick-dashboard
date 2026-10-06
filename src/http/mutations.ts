/** Owner-click mutation routes: alert tick, Done ack, hide, layout. Ids are resolved via the CardStore only. */
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { moveToDone } from '../feed/done.js';
import { envelope } from '../feed/ingest.js';
import { errorMessage } from '../utils/errors.js';
import type { AppContext } from './app.js';
import { buildSnapshot } from './app.js';

const LayoutSchema = z
  .array(z.object({ i: z.string(), x: z.number().finite(), y: z.number().finite(), w: z.number().finite(), h: z.number().finite() }))
  .max(10_000);

export function mountMutations(app: Hono, ctx: AppContext): void {
  const ok = (c: Context) => c.json({ rev: buildSnapshot(ctx).rev });
  const fail = (c: Context, err: unknown) =>
    c.json({ error: errorMessage(err) }, 500);

  /** Ids this server already moved to done/: a repeated tick is an idempotent 200 (ids never reach the filesystem). */
  const ticked = new Set<string>();

  app.post('/api/alerts/:id/tick', async (c) => {
    const id = c.req.param('id');
    const entry = ctx.cards.get(id);
    if (!entry) return ticked.has(id) ? ok(c) : c.json({ error: 'not found' }, 404);
    if (entry.status !== 'ok' || envelope(entry.card).kind !== 'alert') return c.json({ error: 'not an alert' }, 400);
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
    if (!entry) return c.json({ error: 'not found' }, 404);
    if (entry.status !== 'ok') return c.json({ error: 'card is broken' }, 400);
    try {
      await ctx.state.ack(entry.key, envelope(entry.card).updatedAt);
    } catch (err) {
      return fail(c, err);
    }
    return ok(c);
  });

  app.delete('/api/cards/:id/done', async (c) => {
    const id = c.req.param('id');
    if (!ctx.cards.get(id)) return c.json({ error: 'not found' }, 404);
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
      if (!ctx.cards.get(id)) return c.json({ error: 'not found' }, 404);
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
      return c.json({ error: 'invalid JSON' }, 400);
    }
    const parsed = LayoutSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'invalid layout' }, 400);
    try {
      await ctx.state.setLayout(parsed.data);
    } catch (err) {
      return fail(c, err);
    }
    return ok(c);
  });
}
