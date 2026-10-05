// Fails clearly when the build output is incomplete (used by verify scripts / CI).
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const required = ['dist/cli/index.js', 'dist/server/index.js', 'dist/index.js', 'dist/index.d.ts', 'dist/ui/index.html'];
const missing = required.filter((p) => !existsSync(join(root, p)));
if (missing.length) {
  console.error(`check-dist-built: missing ${missing.join(', ')}. Run "npm run build".`);
  process.exit(1);
}
console.log('check-dist-built: ok');
