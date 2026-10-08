/** Copies packaged JSON Schemas into `<data>/schemas/` so card `$schema` refs (`../../schemas/<file>`) resolve. */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageAssets, type PackageAssets } from './cli/assets.js';
import { dataDir } from './paths.js';

export interface SchemaSyncResult {
  synced: string[];
  unchanged: string[];
  warnings: string[];
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Overwrites only files whose content differs; deletes nothing; never throws (failures become warnings). */
export function syncSchemas(
  env: NodeJS.ProcessEnv = process.env,
  assets: PackageAssets = packageAssets(),
): SchemaSyncResult {
  const result: SchemaSyncResult = { synced: [], unchanged: [], warnings: [] };
  let target: string;
  let names: string[];
  try {
    target = join(dataDir(env), 'schemas');
    names = readdirSync(assets.schemasDir).filter((n) => n.endsWith('.json')).sort();
    mkdirSync(target, { recursive: true, mode: 0o700 });
  } catch (e) {
    result.warnings.push(`schema sync failed: ${msg(e)}`);
    return result;
  }
  for (const name of names) {
    try {
      const src = readFileSync(join(assets.schemasDir, name));
      const dest = join(target, name);
      let same = false;
      try {
        same = src.equals(readFileSync(dest));
      } catch {
        /* missing or unreadable: write */
      }
      if (same) result.unchanged.push(name);
      else {
        writeFileSync(dest, src);
        result.synced.push(name);
      }
    } catch (e) {
      result.warnings.push(`schema sync failed for ${name}: ${msg(e)}`);
    }
  }
  return result;
}
