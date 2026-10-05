import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';
import { getExampleFile, listTypes, registry, type RegisteredType } from '../../contract/index.js';
import { packageAssets } from '../assets.js';
import { CliError, type CliContext } from '../io.js';

export function registerTemplates(program: Command, ctx: CliContext): void {
  program
    .command('templates')
    .description('List card types, or print a type\'s example card (--schema for its JSON Schema, --path for file paths)')
    .argument('[type]', `card type (${listTypes().join(', ')})`)
    .option('--schema', "print the type's JSON Schema")
    .option('--path', 'print the example and schema file paths')
    .action(async (type: string | undefined, opts: { schema?: boolean; path?: boolean }) => {
      const { templatesDir, schemasDir } = packageAssets();
      if (type === undefined) {
        const types = listTypes();
        const w = Math.max(4, ...types.map((t) => t.length));
        const kw = Math.max(5, ...types.map((t) => registry[t].allowedKinds.join(',').length));
        ctx.io.stdout(`${'TYPE'.padEnd(w)}  ${'KINDS'.padEnd(kw)}  EXAMPLE\n`);
        for (const t of types) {
          const kinds = registry[t].allowedKinds.join(',');
          ctx.io.stdout(`${t.padEnd(w)}  ${kinds.padEnd(kw)}  ${join(templatesDir, registry[t].example)}\n`);
        }
        return;
      }
      const file = getExampleFile(type);
      if (file === undefined) {
        throw new CliError(`error: unknown type "${type}" (valid types: ${listTypes().join(', ')})`, 2);
      }
      const examplePath = join(templatesDir, file);
      const schemaPath = join(schemasDir, `${type as RegisteredType}.json`);
      if (opts.path) ctx.io.stdout(`${examplePath}\n${schemaPath}\n`);
      else if (opts.schema) ctx.io.stdout(await readFile(schemaPath, 'utf8'));
      else ctx.io.stdout(await readFile(examplePath, 'utf8'));
    });
}
