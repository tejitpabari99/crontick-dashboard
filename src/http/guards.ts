/** Security middleware: Host allowlist (DNS rebinding) and the mutation guard. No CORS headers anywhere. */
import type { MiddlewareHandler } from 'hono';
import { ERROR_CODES } from '../constants/error-codes.js';
import { apiError } from './errors.js';
import { JSON_CONTENT_TYPE, LOOPBACK_HOST, MUTATION_HEADER, MUTATION_HEADER_VALUE } from '../constants/http.js';

/** Reject requests whose Host is not `127.0.0.1:<port>` / `localhost:<port>`. */
export function hostGuard(getPort: () => number): MiddlewareHandler {
  return async (c, next) => {
    const host = (c.req.header('host') ?? '').toLowerCase();
    const port = getPort();
    if (host !== `${LOOPBACK_HOST}:${port}` && host !== `localhost:${port}`) return apiError(c, 403, ERROR_CODES.HOST_FORBIDDEN, `request Host must be ${LOOPBACK_HOST}:${port} or localhost:${port}`);
    await next();
  };
}

/** Non-GET/HEAD requests need `Content-Type: application/json` and `X-Crontick-Dashboard: 1`. */
export const mutationGuard: MiddlewareHandler = async (c, next) => {
  const m = c.req.method;
  if (m !== 'GET' && m !== 'HEAD') {
    const ct = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (ct !== JSON_CONTENT_TYPE || c.req.header(MUTATION_HEADER) !== MUTATION_HEADER_VALUE) {
      return apiError(c, 403, ERROR_CODES.MUTATION_HEADER_REQUIRED, `forbidden: send Content-Type: ${JSON_CONTENT_TYPE} and ${MUTATION_HEADER}: ${MUTATION_HEADER_VALUE}`);
    }
  }
  await next();
};
