// Copies the Vite build (ui/dist) into dist/ui after tsup (tsup `clean` wipes dist, so UI builds elsewhere first).
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const src = join(root, 'ui', 'dist');
const dest = join(root, 'dist', 'ui');
if (!existsSync(join(src, 'index.html'))) {
  console.error(`copy-ui: ${src}/index.html missing. Run "npm run build:ui" first (or "npm run build").`);
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log('copy-ui: ui/dist -> dist/ui');
