import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const bin = join(__dirname, '..', '..', 'dist', 'cli', 'index.js');

describe.skipIf(!existsSync(bin))('built CLI guard (dist/cli/index.js; skipped: run "npm run build")', () => {
  it('has no static heavy imports and dynamically imports ./main.js', () => {
    const src = readFileSync(bin, 'utf8');
    expect(src).not.toMatch(/^\s*import\s[^;]*?from\s*['"](commander|hono|@hono\/node-server|zod|croner|env-paths)/m);
    expect(src).toMatch(/import\(\s*["']\.\/main\.js["']\s*\)/);
  });
});
