/** POST /api/cards/:id/actions — server-authoritative item actions (Decision 8). */
import type { Hono } from 'hono';
import { z } from 'zod';
import { envelope } from '../feed/ingest.js';
import { sameInstant } from '../instant.js';
import { findItemAction } from '../actions/lookup.js';
import { actionRegistry } from '../actions/registry.js';
import type { AppContext } from './app.js';
import { buildSnapshot } from './app.js';
import { errorMessage } from '../utils/errors.js';

const BodySchema = z.object({
  itemId: z.string().min(1),
  updatedAt: z.string(),
  checked: z.boolean().optional(),
});

export function mountActions(app: Hono, ctx: AppContext): void {
  app.post('/api/cards/:id/actions', async (c) => {
    const entry = ctx.cards.get(c.req.param('id'));
    if (!entry) return c.json({ error: 'not found' }, 404);
    if (entry.status !== 'ok') return c.json({ error: 'card is broken' }, 400);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    const body = BodySchema.safeParse(raw);
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const { itemId, updatedAt } = body.data;
    const env = envelope(entry.card);
    if (!sameInstant(updatedAt, env.updatedAt)) return c.json({ error: 'card updated' }, 409);
    const item = findItemAction(env.data, itemId);
    if (!item) return c.json({ error: 'item not found' }, 404);
    const type = item.type;
    if (type === undefined || !Object.hasOwn(actionRegistry, type)) return c.json({ error: 'item has no action' }, 400);
    try {
      const res = await actionRegistry[type as keyof typeof actionRegistry](
        { entry, itemId, checked: body.data.checked ?? true, updatedAt },
        { state: ctx.state, clock: ctx.clock, feedDir: ctx.feedDir, refreshFeed: ctx.refreshFeed, selfWrites: ctx.selfWrites, ...ctx.actionTestDeps },
      );
      if (!res.ok) return c.json({ error: res.error }, res.status);
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 500);
    }
    return c.json({ rev: buildSnapshot(ctx).rev });
  });
}
