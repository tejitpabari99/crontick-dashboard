import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeClock } from '../../src/clock.js';
import { bindPort } from '../../src/http/bind-port.js';
import { startServer, type RunningServer } from '../../src/http/server.js';
import { portFilePath } from '../../src/paths.js';

let data: string;
let ui: string;
let running: RunningServer | undefined;
let blockers: Server[] = [];
const clock = fakeClock('2026-06-01T12:00:00Z');
const notices: string[] = [];
const logger = { info: (m: string) => void notices.push(m), warn: (m: string) => void notices.push(m) };
const env = (): NodeJS.ProcessEnv => ({ CRONTICK_DASHBOARD_HOME: data });

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'http-data-'));
  ui = mkdtempSync(join(tmpdir(), 'http-ui-'));
  writeFileSync(join(ui, 'index.html'), '<html>SPA</html>');
  mkdirSync(join(ui, 'assets'));
  writeFileSync(join(ui, 'assets', 'a.js'), 'console.log(1)');
  notices.length = 0;
});
afterEach(async () => {
  await running?.stop();
  running = undefined;
  await Promise.all(blockers.map((b) => new Promise((r) => b.close(r))));
  blockers = [];
  rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  rmSync(ui, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function boot(port = 0): Promise<RunningServer> {
  running = await startServer({ env: env(), clock, uiDir: ui, logger, port });
  return running;
}
const get = (s: RunningServer, path: string, headers: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${s.port}${path}`, { headers });

/** Raw request so we control the Host header. */
function raw(port: number, method: string, path: string, headers: Record<string, string>): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('http server', () => {
  it('serves snapshot with ETag and 304 on match', async () => {
    const s = await boot();
    const r = await get(s, '/api/snapshot');
    expect(r.status).toBe(200);
    const etag = r.headers.get('etag');
    const body = (await r.json()) as { rev: string };
    expect(etag).toBe(`"${body.rev}"`);
    const r2 = await get(s, '/api/snapshot', { 'If-None-Match': etag! });
    expect(r2.status).toBe(304);
    const r3 = await get(s, '/api/snapshot', { 'If-None-Match': '"nope"' });
    expect(r3.status).toBe(200);
  });

  it('health reports app, pid, dataDir', async () => {
    const s = await boot();
    expect(await (await get(s, '/api/health')).json()).toEqual({ app: 'crontick-dashboard', pid: process.pid, dataDir: data });
  });

  it('listens on 127.0.0.1 only and writes/removes the port file', async () => {
    const s = await boot();
    const addr = s.address();
    expect(addr.address).toBe('127.0.0.1');
    expect(readFileSync(portFilePath(env()), 'utf8').trim()).toBe(String(s.port));
    expect(s.url).toBe(`http://127.0.0.1:${s.port}`);
    await s.stop();
    running = undefined;
    expect(existsSync(portFilePath(env()))).toBe(false);
  });

  it('rejects non-loopback Host with 403 and allows localhost', async () => {
    const s = await boot();
    expect((await raw(s.port, 'GET', '/api/health', { Host: 'evil.example.com' })).status).toBe(403);
    expect((await raw(s.port, 'GET', '/api/health', { Host: `evil.com:${s.port}` })).status).toBe(403);
    expect((await raw(s.port, 'GET', '/api/health', { Host: `127.0.0.1:${s.port + 1}` })).status).toBe(403);
    expect((await raw(s.port, 'GET', '/api/health', { Host: `localhost:${s.port}` })).status).toBe(200);
    expect((await raw(s.port, 'GET', '/', { Host: 'evil.com' })).status).toBe(403);
  });

  it('mutation guard needs JSON content-type and X-Crontick-Dashboard', async () => {
    const s = await boot();
    const url = `http://127.0.0.1:${s.port}/api/shutdown`;
    expect((await fetch(url, { method: 'POST' })).status).toBe(403);
    expect((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } })).status).toBe(403);
    expect((await fetch(url, { method: 'POST', headers: { 'X-Crontick-Dashboard': '1' } })).status).toBe(403);
    expect((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Crontick-Dashboard': '1' } })).status).toBe(403);
    expect(existsSync(portFilePath(env()))).toBe(true);
  });

  it('shutdown with guard headers stops the server and calls onShutdown', async () => {
    let called = 0;
    running = await startServer({ env: env(), clock, uiDir: ui, logger, port: 0, onShutdown: () => void called++ });
    const s = running;
    const r = await fetch(`http://127.0.0.1:${s.port}/api/shutdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Crontick-Dashboard': '1' },
    });
    expect(r.status).toBe(200);
    for (let i = 0; i < 50 && existsSync(portFilePath(env())); i++) await new Promise((r2) => setTimeout(r2, 20));
    expect(existsSync(portFilePath(env()))).toBe(false);
    expect(called).toBe(1);
  });

  it('serves static files, SPA fallback, 404 for unknown /api, no CSP/CORS', async () => {
    const s = await boot();
    const idx = await get(s, '/');
    expect(await idx.text()).toContain('SPA');
    expect(idx.headers.get('content-security-policy')).toBeNull();
    expect(idx.headers.get('access-control-allow-origin')).toBeNull();
    const js = await get(s, '/assets/a.js');
    expect(js.headers.get('content-type')).toContain('javascript');
    expect(await js.text()).toBe('console.log(1)');
    expect(await (await get(s, '/some/route')).text()).toContain('SPA');
    expect((await get(s, '/api/nope')).status).toBe(404);
    expect((await get(s, '/..%2f..%2fetc/passwd')).status).not.toBe(500);
    const trav = await raw(s.port, 'GET', '/%2e%2e/%2e%2e/etc/passwd', { Host: `127.0.0.1:${s.port}` });
    expect(trav.body).not.toContain('root:');
  });

  it('missing index.html throws NOT_BUILT', async () => {
    rmSync(join(ui, 'index.html'));
    await expect(startServer({ env: env(), clock, uiDir: ui, logger, port: 0 })).rejects.toThrow(/NOT_BUILT/);
  });

  it('occupied fixed port falls back to a free port, notice, correct port file', async () => {
    const blocker = createServer((req, res) => res.end('x'));
    blockers.push(blocker);
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const taken = (blocker.address() as AddressInfo).port;
    const s = await boot(taken);
    expect(s.port).not.toBe(taken);
    expect(readFileSync(portFilePath(env()), 'utf8').trim()).toBe(String(s.port));
    expect(notices.join('\n')).toContain(String(taken));
  });
});

describe('bindPort', () => {
  it('rethrows non-EADDRINUSE errors and does not notify', async () => {
    const err = Object.assign(new Error('x'), { code: 'EACCES' });
    await expect(
      bindPort(80, { listen: () => Promise.reject(err), probe: () => Promise.resolve({ kind: 'foreign' }), notify: () => {} }),
    ).rejects.toBe(err);
  });
  it('identifies a crontick-dashboard occupant in the notice', async () => {
    const msgs: string[] = [];
    let first = true;
    const r = await bindPort(5000, {
      listen: (p) => {
        if (first) {
          first = false;
          return Promise.reject(Object.assign(new Error('in use'), { code: 'EADDRINUSE' }));
        }
        return Promise.resolve(p === 0 ? 6000 : p);
      },
      probe: () => Promise.resolve({ kind: 'crontick-dashboard', pid: 42, dataDir: '/d' }),
      notify: (m) => void msgs.push(m),
    });
    expect(r).toMatchObject({ port: 6000, fellBack: true });
    expect(msgs[0]).toContain('pid 42');
  });
});
