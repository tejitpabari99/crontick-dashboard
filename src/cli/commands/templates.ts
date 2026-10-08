import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';
import { listTypes, type RegisteredType } from '../../contract/index.js';
import { packageAssets } from '../assets.js';
import { ERROR_CODES } from '../../constants/error-codes.js';
import { CliError, type CliContext } from '../io.js';

const ALERT = 'alert';
const SUMMARIES: Record<RegisteredType | typeof ALERT, string> = {
  markdown: 'free-form markdown text',
  table: 'rows and columns',
  list: 'items with optional checkboxes and actions',
  kpi: 'headline metrics with values and units',
  media: 'images or video',
  alert: 'one-off notice in feed/alerts/<id>.json',
};

type Which = 'card' | 'data' | 'payload';

export function registerTemplates(program: Command, ctx: CliContext): void {
  program
    .command('templates')
    .description('List card types, or print a type\'s example card folder (--file for one raw file, --schema for JSON Schema, --path for paths)')
    .argument('[type]', `card type (${[...listTypes(), ALERT].join(', ')})`)
    .option('--schema [which]', 'print a JSON Schema: data (default), card, or payload')
    .option('--file <name>', 'print one raw example file: card or data')
    .option('--path', 'print the example folder and schema file paths')
    .action(async (type: string | undefined, opts: { schema?: string | boolean; file?: string; path?: boolean }) => {
      const { templatesDir, schemasDir } = packageAssets();
      const names = [...listTypes(), ALERT];
      if (type === undefined) {
        const w = Math.max(4, ...names.map((t) => t.length));
        const sw = Math.max(7, ...names.map((t) => SUMMARIES[t as keyof typeof SUMMARIES].length));
        ctx.io.stdout(`${'TYPE'.padEnd(w)}  ${'SUMMARY'.padEnd(sw)}  FOLDER\n`);
        for (const t of names) {
          ctx.io.stdout(`${t.padEnd(w)}  ${SUMMARIES[t as keyof typeof SUMMARIES].padEnd(sw)}  ${join(templatesDir, t)}\n`);
        }
        return;
      }
      if (!names.includes(type)) {
        throw new CliError(`error: unknown type "${type}" (valid types: ${names.join(', ')})`, 2, ERROR_CODES.UNKNOWN_TYPE);
      }
      const isAlert = type === ALERT;
      const folder = join(templatesDir, type);
      const cardPath = join(folder, 'card.json');
      const dataPath = join(folder, 'data.json');
      const alertPath = join(folder, 'alert.json');
      const schemaFile = (which: Which): string =>
        which === 'card' ? 'card-def.json'
        : isAlert ? 'alert.json'
        : which === 'payload' ? `${type}.json`
        : `data.${type}.json`;

      if (opts.path) {
        const schemas = isAlert ? [schemaFile('data')] : [schemaFile('card'), schemaFile('data'), schemaFile('payload')];
        ctx.io.stdout(`${folder}\n${schemas.map((s) => `${join(schemasDir, s)}\n`).join('')}`);
        return;
      }
      if (opts.schema !== undefined) {
        const which = opts.schema === true ? 'data' : opts.schema;
        if (which !== 'card' && which !== 'data' && which !== 'payload') {
          throw new CliError(`error: unknown schema "${which}" (valid: card, data, payload)`, 2, ERROR_CODES.UNKNOWN_TYPE);
        }
        ctx.io.stdout(await readFile(join(schemasDir, schemaFile(which)), 'utf8'));
        return;
      }
      if (opts.file !== undefined) {
        if (opts.file !== 'card' && opts.file !== 'data') {
          throw new CliError(`error: unknown file "${opts.file}" (valid: card, data)`, 2, ERROR_CODES.UNKNOWN_TYPE);
        }
        if (isAlert) {
          ctx.io.stdout(await readFile(alertPath, 'utf8'));
        } else {
          ctx.io.stdout(await readFile(opts.file === 'card' ? cardPath : dataPath, 'utf8'));
        }
        return;
      }
      if (isAlert) {
        ctx.io.stdout(`# alert.json\n${await readFile(alertPath, 'utf8')}`);
        return;
      }
      const card = await readFile(cardPath, 'utf8');
      const data = await readFile(dataPath, 'utf8');
      ctx.io.stdout(`# card.json\n${card.endsWith('\n') ? card : `${card}\n`}\n# data.json\n${data}`);
    });
}
