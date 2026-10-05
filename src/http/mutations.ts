/** Owner-click mutation routes: alert tick, Done ack, hide, layout. Ids are resolved via the CardStore only. */
import { copyFile, mkdir, rename, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { envelope } from '../feed/ingest.js';
import type { AppContext } from './app.js';
import { buildSnapshot } from './app.js';

const LayoutSchema = z
  .array(z.object({ i: z.string(), x: z.number().finite(), y: z.number().finite(), w: z.number().finite(), h: z.number().finite() }))
  .max(10_000);

/** Rename `feed/<file>` to `feed/done/<file>` (suffix `-<ts>` on collision; EXDEV falls back to copy+unlink). Gone = ok. */
async function moveToDone(ctx: AppContext, file: string): Promise<void> {
  if (basename(file) !== file) throw new Error('invalid feed file name');
  const src = join(ctx.feedDir, file);
  await mkdir(ctx.doneDir, { recursive: true });
  let target = file;
  if (existsSync(join(ctx.doneDir, target))) {
    const ext = extname(file);
    target = `${file.slice(0, file.length - ext.length)}-${ctx.clock.now().getTime()}${ext}`;
  }
  const dest = join(ctx.doneDir, target);
  try {
    await rename(src, dest);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    if (code !== 'EXDEV') throw err;
    try {
      await copyFile(src, dest);
    } catch (e2) {
      if ((e2 as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e2;
    }
    await unlink(src).catch((e3: NodeJS.ErrnoException) => {
      if (e3.code !== 'ENOENT') throw e3;
    });
  }
}

export function mountMutations(app: Hono, ctx: AppContext): void {
  const ok = (c: Context) => c.json({ rev: buildSnapshot(ctx).rev });
  const fail = (c: Context, err: unknown) =>
    c.json({ error: err instanceof Error ? err.message : String(err) }, 500);

  /** Ids this server already moved to done/: a repeated tick is an idempotent 200 (ids never reach the filesystem). */
  const ticked = new Set<string>();

  app.post('/api/alerts/:id/tick', async (c) => {
    const id = c.req.param('id');
    const entry = ctx.cards.get(id);
    if (!entry) return ticked.has(id) ? ok(c) : c.json({ error: 'not found' }, 404);
    if (entry.status !== 'ok' || envelope(entry.card).kind !== 'alert') return c.json({ error: 'not an alert' }, 400);
    try {
      await moveToDone(ctx, entry.file);
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
