import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSchemas } from './schemas-build.js';

const dir = join(import.meta.dirname, '..', 'schemas');
mkdirSync(dir, { recursive: true });
const files = buildSchemas();
for (const f of readdirSync(dir)) if (!(f in files)) rmSync(join(dir, f));
for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
console.log(`gen:schemas: wrote ${Object.keys(files).length} files to schemas/`);
