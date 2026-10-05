/** Security middleware: Host allowlist (DNS rebinding) and the mutation guard. No CORS headers anywhere. */
import type { MiddlewareHandler } from 'hono';

export const MUTATION_HEADER = 'X-Crontick-Dashboard';

/** Reject requests whose Host is not `127.0.0.1:<port>` / `localhost:<port>`. */
export function hostGuard(getPort: () => number): MiddlewareHandler {
  return async (c, next) => {
    const host = (c.req.header('host') ?? '').toLowerCase();
    const port = getPort();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return c.json({ error: 'forbidden host' }, 403);
    await next();
  };
}

/** Non-GET/HEAD requests need `Content-Type: application/json` and `X-Crontick-Dashboard: 1`. */
export const mutationGuard: MiddlewareHandler = async (c, next) => {
  const m = c.req.method;
  if (m !== 'GET' && m !== 'HEAD') {
    const ct = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (ct !== 'application/json' || c.req.header(MUTATION_HEADER) !== '1') {
      return c.json({ error: 'forbidden: JSON content-type and X-Crontick-Dashboard: 1 required' }, 403);
    }
  }
  await next();
};
