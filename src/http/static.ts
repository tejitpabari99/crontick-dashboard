/** Static UI from an injected uiDir; SPA fallback to index.html (never for /api/*). */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import type { Context } from 'hono';
import { ERROR_CODES } from '../constants/error-codes.js';
import { notBuiltError } from '../utils/errors.js';
import { apiError } from './errors.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

export function assertUiBuilt(uiDir: string): void {
  if (!existsSync(join(uiDir, 'index.html'))) {
    throw notBuiltError('UI', uiDir);
  }
}

function send(c: Context, file: string): Response {
  const body = readFileSync(file);
  return c.body(new Uint8Array(body), 200, {
    'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
  });
}

export function serveStatic(uiDir: string) {
  const root = resolve(uiDir);
  return (c: Context): Response => {
    const path = c.req.path;
    if (path === '/api' || path.startsWith('/api/')) return apiError(c, 404, ERROR_CODES.NOT_FOUND, 'no such API route');
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return apiError(c, 404, ERROR_CODES.NOT_FOUND, 'not found');
    let rel: string;
    try {
      rel = decodeURIComponent(path);
    } catch {
      return apiError(c, 400, ERROR_CODES.BAD_REQUEST, 'malformed URL encoding in path');
    }
    if (!rel.includes('\0')) {
      const file = resolve(root, '.' + (rel.startsWith('/') ? rel : '/' + rel));
      if (file.startsWith(root + sep)) {
        try {
          if (statSync(file).isFile()) return send(c, file);
        } catch {
          /* fall through */
        }
      }
    }
    // Missing asset with an extension is a real 404; extension-less routes are SPA routes.
    if (extname(path) !== '') return apiError(c, 404, ERROR_CODES.NOT_FOUND, 'not found');
    return send(c, join(root, 'index.html'));
  };
}
