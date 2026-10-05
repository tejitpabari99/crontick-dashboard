// THROWAWAY SPIKE (05-notifications Task 1). Not shipped, not imported by src.
// Usage: node src/integrations/notify/spike/notify-spike.mjs [url]
// Fires one toast via node-notifier; click opens url in the default browser.
// Prints every callback/event as JSON lines so the owner can paste them back.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const url = process.argv[2] ?? 'http://127.0.0.1:7777/#card=spike';
const log = (what, data) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), what, data }));

log('env', {
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  ssh: Boolean(process.env.SSH_CONNECTION),
  display: Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY),
});

function openUrl(target) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', target]] // no shell
      : process.platform === 'darwin'
        ? ['open', [target]]
        : ['xdg-open', [target]];
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true, shell: false });
  child.on('error', (e) => log('open-error', String(e)));
  child.unref();
  log('open-spawned', { cmd, args });
}

let notifier;
try {
  notifier = require('node-notifier');
  log('loaded', { exports: Object.keys(notifier).slice(0, 12) });
} catch (e) {
  log('load-failed', String(e));
  process.exit(2);
}

const timeoutMs = 60_000;
const timer = setTimeout(() => {
  log('timeout', `no callback within ${timeoutMs / 1000}s`);
  process.exit(3);
}, timeoutMs);

const n = notifier;
for (const ev of ['click', 'timeout', 'close', 'dismissed', 'fail']) {
  n.on(ev, (...a) => {
    log(`event:${ev}`, a.map((x) => (typeof x === 'object' ? x : String(x))));
    if (ev === 'click') openUrl(url);
  });
}

log('notify-call', { appID: 'Crontick.Dashboard', wait: true, url });
n.notify(
  {
    title: 'Crontick spike',
    message: 'Click me: should open ' + url,
    appID: 'Crontick.Dashboard', // Windows AUMID
    wait: true,
    sound: false,
  },
  (err, response, metadata) => {
    log('callback', { err: err ? String(err) : null, response, metadata });
    if (response === 'activate' || response === 'clicked') openUrl(url);
    clearTimeout(timer);
    setTimeout(() => process.exit(err ? 1 : 0), 1500);
  },
);
