/** POST /api/cards/:id/actions — server-authoritative item actions (Decision 8). */
import type { Hono } from 'hono';
import { z } from 'zod';
import { sameInstant } from '../instant.js';
import { findItemAction } from '../actions/lookup.js';
import { actionRegistry } from '../actions/registry.js';
import type { AppContext } from './app.js';
import { buildSnapshot } from './app.js';
import { CARD_CHANGED_MESSAGE, ERROR_CODES } from '../constants/error-codes.js';
import { apiError, internalError } from './errors.js';

const BROKEN_MESSAGE = 'card is broken; fix the card file';

const BodySchema = z.object({
  itemId: z.string().min(1),
  updatedAt: z.string(),
  checked: z.boolean().optional(),
});

export function mountActions(app: Hono, ctx: AppContext): void {
  app.post('/api/cards/:id/actions', async (c) => {
    const entry = ctx.cards.get(c.req.param('id'));
    if (!entry) return apiError(c, 404, ERROR_CODES.CARD_NOT_FOUND, 'no card with that id; reload the page');
    if (entry.status !== 'ok') return apiError(c, 400, ERROR_CODES.CARD_BROKEN, BROKEN_MESSAGE);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return apiError(c, 400, ERROR_CODES.INVALID_JSON, 'request body must be valid JSON');
    }
    const body = BodySchema.safeParse(raw);
    if (!body.success) return apiError(c, 400, ERROR_CODES.INVALID_BODY, 'body must be { itemId, updatedAt, checked? }');
    const { itemId, updatedAt } = body.data;
    const env = entry.card;
    if (!sameInstant(updatedAt, env.updatedAt)) return apiError(c, 409, ERROR_CODES.CARD_CHANGED, CARD_CHANGED_MESSAGE);
    const item = findItemAction(env.data, itemId);
    if (!item) return apiError(c, 404, ERROR_CODES.ITEM_NOT_FOUND, 'no such item on this card; reload the page');
    const type = item.type;
    if (type === undefined || !Object.hasOwn(actionRegistry, type)) return apiError(c, 400, ERROR_CODES.ITEM_NO_ACTION, 'this item has no action');
    try {
      const res = await actionRegistry[type as keyof typeof actionRegistry](
        { entry, itemId, checked: body.data.checked ?? true, updatedAt },
        { state: ctx.state, clock: ctx.clock, feedDir: ctx.feedDir, refreshFeed: ctx.refreshFeed, selfWrites: ctx.selfWrites, ...ctx.actionTestDeps },
      );
      if (!res.ok) return apiError(c, res.status, res.code, res.error);
    } catch (err) {
      return internalError(c, err, ctx.log);
    }
    return c.json({ rev: buildSnapshot(ctx).rev });
  });
}
