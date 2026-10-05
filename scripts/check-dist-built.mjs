// Fails clearly when the build output is incomplete (used by verify scripts / CI).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const required = ['dist/cli/index.js', 'dist/server/index.js', 'dist/index.js', 'dist/index.d.ts', 'dist/ui/index.html'];
const missing = required.filter((p) => !existsSync(join(root, p)));
if (missing.length) {
  console.error(`check-dist-built: missing ${missing.join(', ')}. Run "npm run build".`);
  process.exit(1);
}
// The bin must only dynamically import ./main.js, so the Node-version guard runs before any heavy import.
const bin = readFileSync(join(root, 'dist/cli/index.js'), 'utf8');
const staticHeavy = /^\s*import\s[^;]*?from\s*['"](commander|hono|@hono\/node-server|zod|croner|env-paths)/m;
if (staticHeavy.test(bin) || !/import\(\s*['"]\.\/main\.js['"]\s*\)/.test(bin)) {
  console.error('check-dist-built: dist/cli/index.js must only dynamically import ./main.js (Node guard defeated by bundling).');
  process.exit(1);
}
console.log('check-dist-built: ok');
