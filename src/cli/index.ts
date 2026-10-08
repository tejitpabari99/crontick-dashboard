// Bin entry (built to dist/cli/index.js): tiny on purpose. Checks the Node version, then loads ./main.js.
import { guardedMain } from './guard.js';

await guardedMain({
  version: process.versions.node,
  load: () => import('./main.js'),
  stderr: (s) => void process.stderr.write(s),
  exit: (code) => void (process.exitCode = code),
});
