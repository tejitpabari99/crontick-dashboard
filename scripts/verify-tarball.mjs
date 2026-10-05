#!/usr/bin/env node
/**
 * Shape check of the publishable tarball (`npm pack --dry-run --json`). Run after `npm run build`.
 * The behavioural check is scripts/verify-package-install.mjs.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const isWindows = process.platform === 'win32';
const out = execFileSync(isWindows ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--json'], {
  cwd: root,
  encoding: 'utf8',
  shell: isWindows,
  stdio: ['ignore', 'pipe', 'ignore'],
});
const files = (JSON.parse(out)[0]?.files ?? []).map((f) => f.path.replaceAll('\\', '/'));
console.log(`Packed ${files.length} files`);

const errors = [];
const required = [
  'package.json',
  'dist/cli/index.js',
  'dist/cli/main.js',
  'dist/server/index.js',
  'dist/index.js',
  'dist/index.d.ts',
  'dist/ui/index.html',
  'src/skill/SKILL.md',
  'README.md',
  'LICENSE',
];
for (const r of required) if (!files.includes(r)) errors.push(`missing: ${r}`);
if (!files.some((f) => f.startsWith('schemas/') && f.endsWith('.json'))) errors.push('missing: schemas/*.json');
if (!files.some((f) => f.startsWith('templates/') && f.endsWith('.json'))) errors.push('missing: templates/*.json');
for (const f of files) {
  if (f.startsWith('src/') && f !== 'src/skill/SKILL.md') errors.push(`unexpected source file: ${f}`);
  if (f.startsWith('tests/') || /\.test\.[cm]?[jt]sx?$/.test(f)) errors.push(`test file shipped: ${f}`);
  if (f.startsWith('docs/') || f.startsWith('scripts/') || f.startsWith('.worktrees/')) errors.push(`unexpected file: ${f}`);
}
if (errors.length > 0) {
  console.error(`Tarball verification FAILED:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log('Tarball verification OK');
