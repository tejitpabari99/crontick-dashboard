/** Uniform HTTP error body `{ error, code }`; 500s never echo raw exception text. */
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ERROR_CODES, type ErrorCode } from '../constants/error-codes.js';
import { errorMessage } from '../utils/errors.js';

export function apiError(c: Context, status: ContentfulStatusCode, code: ErrorCode, message: string): Response {
  return c.json({ error: message, code }, status);
}

/** Fixed-message 500; the detail goes to the server log only. */
export function internalError(c: Context, err: unknown, log?: (m: string) => void): Response {
  log?.(`internal error on ${c.req.method} ${c.req.path}: ${errorMessage(err)}`);
  return apiError(c, 500, ERROR_CODES.INTERNAL, 'internal server error; see the server log (crontick-dashboard daemon status shows its path)');
}
