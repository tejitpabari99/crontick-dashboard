import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeClock } from '../../src/clock.js';
import { ERROR_CODES } from '../../src/constants/error-codes.js';
import { ENV_HOME } from '../../src/constants/env.js';
import { MUTATION_HEADER, MUTATION_HEADER_VALUE } from '../../src/constants/http.js';
import { startServer, type RunningServer } from '../../src/http/server.js';
import { loopbackUrl } from '../../src/utils/loopback.js';

let data: string;
let ui: string;
let running: RunningServer | undefined;
const clock = fakeClock('2026-06-01T12:00:00Z');
const T = '2026-06-01T10:00:00Z';

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'ec-data-'));
  ui = mkdtempSync(join(tmpdir(), 'ec-ui-'));
  writeFileSync(join(ui, 'index.html'), '<html></html>');
  mkdirSync(join(data, 'feed'), { recursive: true });
  writeFileSync(
    join(data, 'feed', 'p1.json'),
    JSON.stringify({ id: 'p1', kind: 'panel', type: 'list', title: 'p1', updatedAt: T, data: { items: [{ id: 'n', text: 'x' }] } }),
  );
  writeFileSync(join(data, 'feed', 'bad.json'), '{ not json');
});
afterEach(async () => {
  await running?.stop();
  running = undefined;
  rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  rmSync(ui, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function req(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  running ??= await startServer({ env: { [ENV_HOME]: data }, clock, uiDir: ui, port: 0 });
  const res = await fetch(`${loopbackUrl(running.port)}${path}`, {
    method,
    headers: headers ?? { 'Content-Type': 'application/json', [MUTATION_HEADER]: MUTATION_HEADER_VALUE },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as { error: string; code: string } };
}

describe('HTTP error codes', () => {
  const cases: Array<[string, string, string, unknown, number, string]> = [
    ['unknown API route', 'GET', '/api/nope', undefined, 404, ERROR_CODES.NOT_FOUND],
    ['unknown card (actions)', 'POST', '/api/cards/zz/actions', { itemId: 'n', updatedAt: T }, 404, ERROR_CODES.CARD_NOT_FOUND],
    ['unknown card (done)', 'POST', '/api/cards/zz/done', undefined, 404, ERROR_CODES.CARD_NOT_FOUND],
    ['bad JSON', 'POST', '/api/cards/p1/actions', '{ nope', 400, ERROR_CODES.INVALID_JSON],
    ['bad body', 'POST', '/api/cards/p1/actions', { itemId: '' }, 400, ERROR_CODES.INVALID_BODY],
    ['stale updatedAt', 'POST', '/api/cards/p1/actions', { itemId: 'n', updatedAt: '2025-01-01T00:00:00Z' }, 409, ERROR_CODES.CARD_CHANGED],
    ['missing item', 'POST', '/api/cards/p1/actions', { itemId: 'zz', updatedAt: T }, 404, ERROR_CODES.ITEM_NOT_FOUND],
    ['item without action', 'POST', '/api/cards/p1/actions', { itemId: 'n', updatedAt: T }, 400, ERROR_CODES.ITEM_NO_ACTION],
    ['tick non-alert', 'POST', '/api/alerts/p1/tick', undefined, 400, ERROR_CODES.NOT_AN_ALERT],
  ];
  it.each(cases)('%s', async (_n, method, path, body, status, code) => {
    const r = await req(method, path, body);
    expect(r.status).toBe(status);
    expect(r.body.code).toBe(code);
    expect(typeof r.body.error).toBe('string');
  });

  it('mutation guard and host guard carry codes', async () => {
    const g = await req('POST', '/api/cards/p1/done', undefined, { 'Content-Type': 'text/plain' });
    expect(g.status).toBe(403);
    expect(g.body.code).toBe(ERROR_CODES.MUTATION_HEADER_REQUIRED);
  });

  it('malformed URL encoding is BAD_REQUEST', async () => {
    const r = await req('GET', '/%E0%A4%A');
    expect(r.status).toBe(400);
    expect(r.body.code).toBe(ERROR_CODES.BAD_REQUEST);
  });
});
