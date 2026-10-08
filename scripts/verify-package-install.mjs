#!/usr/bin/env node
/**
 * Proves the REAL tarball works: pack -> install into a scratch project -> run the installed bin
 * (resolved from its package.json `bin`, invoked with `node`, no npx/shims) with an isolated
 * CRONTICK_DASHBOARD_HOME and a non-default port. Run after `npm run build`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';
const TYPES = ['kpi', 'list', 'markdown', 'media', 'table'];

const tmp = mkdtempSync(join(tmpdir(), 'cd-verify-'));
const scratch = join(tmp, 'project');
const home = join(tmp, 'home');
let bin;
let port;
let childEnv;

const log = (m) => console.log(`[verify-package-install] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function rmWithRetry(path, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (err) {
      if (i === attempts - 1) throw err;
      sleepSync(400);
    }
  }
}

/** Best effort: stop the daemon (also kills by pid file if the CLI stop fails), then remove temp dirs. */
function cleanup() {
  try {
    if (bin && childEnv) spawnSync(process.execPath, [bin, 'daemon', 'stop'], { env: childEnv, timeout: 20000 });
  } catch {
    /* ignore */
  }
  try {
    const pid = parseInt(readFileSync(join(home, 'daemon.pid'), 'utf8').trim(), 10);
    if (Number.isInteger(pid) && pid > 0) process.kill(pid, 'SIGKILL');
  } catch {
    /* gone */
  }
  try {
    rmWithRetry(tmp);
  } catch (e) {
    console.error(`cleanup: could not remove ${tmp}: ${e}`);
  }
}

function fail(msg) {
  console.error(`\n[verify-package-install] FAILED: ${msg}\n`);
  cleanup();
  process.exit(1);
}
const assert = (cond, msg) => {
  if (!cond) fail(msg);
};

function cli(args, { input } = {}) {
  const r = spawnSync(process.execPath, [bin, ...args], { env: childEnv, cwd: scratch, encoding: 'utf8', input, timeout: 60000 });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function get(path) {
  return new Promise((res, rej) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers: { Host: `127.0.0.1:${port}` } }, (r) => {
      let body = '';
      r.setEncoding('utf8');
      r.on('data', (d) => (body += d));
      r.on('end', () => res({ status: r.statusCode, body, headers: r.headers }));
    });
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    req.on('error', rej);
    req.end();
  });
}

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port: p } = s.address();
      s.close(() => res(p));
    });
  });
}

async function main() {
  log('npm pack (real tarball)...');
  const packOut = execFileSync(npmCmd, ['pack', '--json', '--pack-destination', tmp], { cwd: root, encoding: 'utf8', shell: isWindows, stdio: ['ignore', 'pipe', 'inherit'] });
  const tarball = join(tmp, JSON.parse(packOut)[0].filename);
  assert(existsSync(tarball), `tarball not found: ${tarball}`);

  mkdirSync(scratch, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(scratch, 'package.json'), JSON.stringify({ name: 'cd-verify-scratch', version: '0.0.0', private: true }));
  log('npm install tarball into scratch project...');
  execFileSync(npmCmd, ['install', tarball, '--no-audit', '--no-fund', '--no-save'], { cwd: scratch, stdio: 'inherit', shell: isWindows });

  const pkgDir = join(scratch, 'node_modules', 'crontick-dashboard');
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  assert(pkg.bin?.['crontick-dashboard'], 'installed package.json has no bin entry');
  bin = join(pkgDir, pkg.bin['crontick-dashboard']);
  port = await freePort();
  childEnv = { ...process.env, CRONTICK_DASHBOARD_HOME: home, CRONTICK_DASHBOARD_PORT: String(port) };
  delete childEnv.CRONTICK_DASHBOARD_VERBOSE;

  // --version
  let r = cli(['--version']);
  assert(r.code === 0 && r.stdout.trim() === pkg.version, `--version: code=${r.code} out=${r.stdout.trim()} expected ${pkg.version}`);
  log(`--version -> ${r.stdout.trim()}`);

  // templates lists 5 types + alert
  r = cli(['templates']);
  assert(r.code === 0, `templates exit ${r.code}: ${r.stderr}`);
  for (const t of [...TYPES, 'alert']) assert(new RegExp(`^${t}\\s`, 'm').test(r.stdout), `templates output missing type ${t}`);
  log('templates lists 5 types + alert');

  // every shipped example (card.json + data.json) validates via stdin
  for (const t of TYPES) {
    const c = cli(['templates', t, '--file', 'card']);
    const d = cli(['templates', t, '--file', 'data']);
    assert(c.code === 0 && d.code === 0 && c.stdout.length > 0 && d.stdout.length > 0, `templates ${t} --file failed: ${c.stderr}${d.stderr}`);
    const vc = cli(['validate', '-', '--as', 'card'], { input: c.stdout });
    assert(vc.code === 0, `validate ${t} card exit ${vc.code}: ${vc.stdout}${vc.stderr}`);
    const vd = cli(['validate', '-', '--as', 'data', '--type', t], { input: d.stdout });
    assert(vd.code === 0, `validate ${t} data exit ${vd.code}: ${vd.stdout}${vd.stderr}`);
  }
  log('5 shipped templates validate (exit 0)');

  // broken card folder exits 1 with parseable --json
  const broken = join(scratch, 'broken');
  mkdirSync(broken, { recursive: true });
  writeFileSync(join(broken, 'card.json'), JSON.stringify({ type: 'not-a-type', title: 'x' }));
  r = cli(['validate', '--json', broken]);
  assert(r.code === 1, `broken fixture expected exit 1, got ${r.code}\n${r.stdout}${r.stderr}`);
  let parsed;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    fail(`validate --json output is not JSON: ${r.stdout}`);
  }
  assert(Array.isArray(parsed) && parsed[0]?.result?.status === 'broken', 'validate --json result is not broken');
  log('broken fixture exit 1, --json parses');

  // info --json paths exist
  r = cli(['info', '--json']);
  assert(r.code === 0, `info --json exit ${r.code}: ${r.stderr}`);
  const info = JSON.parse(r.stdout);
  assert(info.version === pkg.version, 'info.version mismatch');
  assert(info.running === false, 'info.running should be false before start');
  for (const k of ['templatesDir', 'schemasDir', 'skillPath']) assert(existsSync(info[k]), `info.${k} does not exist: ${info[k]}`);
  assert(existsSync(join(pkgDir, 'dist', 'ui', 'index.html')), 'dist/ui/index.html missing in installed package');
  assert(info.dataDir === home, `info.dataDir ${info.dataDir} != ${home}`);
  log('info --json paths exist');

  // daemon start -> health + GET /
  r = cli(['daemon', 'start']);
  assert(r.code === 0, `daemon start exit ${r.code}: ${r.stdout}${r.stderr}`);
  log(r.stdout.split('\n')[0]);
  const health = await get('/api/health');
  assert(health.status === 200 && JSON.parse(health.body).app === 'crontick-dashboard', `bad /api/health: ${health.status} ${health.body}`);
  const index = await get('/');
  assert(index.status === 200 && /<html/i.test(index.body), `GET / not HTML: ${index.status}`);
  log('GET /api/health ok, GET / returns HTML');

  // `new` then `validate` from the packed tarball (feed dir comes from info --json)
  const feed = info.feedDir;
  r = cli(['new', 'verify-install-card', '--type', 'table', '--title', 'Verify install', '--column', 'center', '--height', 'M']);
  assert(r.code === 0, `new exit ${r.code}: ${r.stdout}${r.stderr}`);
  const folder = join(feed, 'verify-install-card');
  assert(existsSync(join(folder, 'card.json')), 'new did not write card.json');
  r = cli(['validate', folder]);
  assert(r.code === 0 && /NO DATA/.test(r.stdout), `validate before data expected exit 0 + NO DATA: ${r.code} ${r.stdout}${r.stderr}`);
  const data = JSON.parse(cli(['templates', 'table', '--file', 'data']).stdout);
  data.updatedAt = new Date().toISOString();
  const tmpName = join(folder, 'data.json.tmp');
  writeFileSync(tmpName, JSON.stringify(data));
  renameSync(tmpName, join(folder, 'data.json'));
  r = cli(['validate', folder]);
  assert(r.code === 0 && /^OK /m.test(r.stdout) && !/warning/.test(r.stdout), `validate after data expected OK, no warnings: ${r.code} ${r.stdout}${r.stderr}`);
  log('new + validate (exit 0, no warnings) from tarball');
  let seen = false;
  for (let i = 0; i < 50 && !seen; i++) {
    const s = await get('/api/snapshot');
    seen = s.status === 200 && s.body.includes('verify-install-card');
    if (!seen) await sleep(200);
  }
  assert(seen, 'card did not appear in /api/snapshot within 10s');
  log('card appeared in /api/snapshot');

  // status 0, stop removes port file
  r = cli(['daemon', 'status']);
  assert(r.code === 0, `daemon status exit ${r.code}: ${r.stdout}${r.stderr}`);
  assert(existsSync(join(home, 'daemon.port')), 'port file missing while running');
  r = cli(['daemon', 'stop']);
  assert(r.code === 0, `daemon stop exit ${r.code}: ${r.stdout}${r.stderr}`);
  assert(!existsSync(join(home, 'daemon.port')), 'port file still present after stop');
  r = cli(['daemon', 'status']);
  assert(r.code === 3, `daemon status after stop expected 3, got ${r.code}`);
  log('daemon status 0 -> stop removed port file -> status 3');

  cleanup();
  console.log('\n[verify-package-install] OK: tarball installs and the installed bin works end to end.');
}

main().catch((err) => fail(err instanceof Error ? (err.stack ?? err.message) : String(err)));
