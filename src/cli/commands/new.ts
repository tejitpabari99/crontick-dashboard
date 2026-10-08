import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Command } from 'commander';
import { CARD_DEF_FILE, DEFAULT_DATA_FILE } from '../../constants/contract.js';
import { ERROR_CODES } from '../../constants/error-codes.js';
import { getExample, isCardFolderName, listTypes, parseCardDef } from '../../contract/index.js';
import { ensureDirs, feedDir } from '../../paths.js';
import { syncSchemas } from '../../schemas-sync.js';
import { packageAssets } from '../assets.js';
import { CliError, type CliContext } from '../io.js';

interface NewOpts {
  type?: string;
  title?: string;
  column?: string;
  order?: string;
  height?: string;
  priority?: string;
  force?: boolean;
  withExample?: boolean;
  json?: boolean;
}

const COLUMNS = ['left', 'center', 'right'];
const HEIGHTS = ['S', 'M', 'L', 'auto'];

const bad = (msg: string): CliError => new CliError(`error: ${msg}`, 2, ERROR_CODES.INVALID_OPTION);

function intOption(name: string, raw: string, min?: number, max?: number): number {
  if (!/^-?\d+$/.test(raw)) throw bad(`${name} must be an integer`);
  const n = Number(raw);
  if ((min !== undefined && n < min) || (max !== undefined && n > max)) {
    throw bad(`${name} must be ${min !== undefined && max !== undefined ? `${min}-${max}` : 'an integer'}`);
  }
  return n;
}

function defaultTitle(id: string): string {
  const t = id.replace(/-/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;

export function registerNew(program: Command, ctx: CliContext): void {
  program
    .command('new')
    .description('Scaffold a card folder (card.json only; the agent writes data.json)')
    .argument('<id>', 'card id (becomes the folder name)')
    .requiredOption('--type <type>', `card type (${listTypes().join(', ')})`)
    .option('--title <title>', 'card title (default: id with dashes as spaces)')
    .option('--column <column>', 'left, center or right')
    .option('--order <n>', 'order within the column (integer)')
    .option('--height <height>', 'S, M, L or auto')
    .option('--priority <n>', 'priority 0-5')
    .option('--force', 'rewrite card.json of an existing card (data.json untouched)')
    .option('--with-example', 'also write the type\'s example data.json')
    .option('--json', 'print {id, dir, cardPath, dataPath, schemasSynced}')
    .action((id: string, opts: NewOpts) => {
      const kind = isCardFolderName(id);
      if (kind !== 'ok') {
        const why = kind === 'reserved' ? 'is reserved' : kind === 'ignore' ? 'must not start with "."' : 'is not a valid card id';
        throw new CliError(`error: card id "${id}" ${why}`, 2, ERROR_CODES.BAD_REQUEST);
      }
      const type = opts.type as string;
      const example = getExample(type);
      if (!example) {
        throw new CliError(`error: unknown type "${type}" (valid types: ${listTypes().join(', ')})`, 2, ERROR_CODES.UNKNOWN_TYPE);
      }
      const layout: Record<string, unknown> = {};
      if (opts.column !== undefined) {
        if (!COLUMNS.includes(opts.column)) throw bad(`--column must be one of ${COLUMNS.join(', ')}`);
        layout.column = opts.column;
      }
      if (opts.order !== undefined) layout.order = intOption('--order', opts.order);
      if (opts.height !== undefined) {
        if (!HEIGHTS.includes(opts.height)) throw bad(`--height must be one of ${HEIGHTS.join(', ')}`);
        layout.height = opts.height;
      }
      const priority = opts.priority !== undefined ? intOption('--priority', opts.priority, 0, 5) : undefined;

      // Only the type carries over from the example card; its title/layout/priority are sample values.
      const card: Record<string, unknown> = {
        $schema: '../../schemas/card-def.json',
        type: example.card.type ?? type,
        title: opts.title ?? defaultTitle(id),
      };
      if (Object.keys(layout).length > 0) card.layout = layout;
      if (priority !== undefined) card.priority = priority;
      const cardText = json(card);
      const check = parseCardDef(id, cardText);
      if (check.status !== 'ok') {
        throw new CliError(`internal error: generated card.json failed validation: ${check.message}`, 1, ERROR_CODES.INTERNAL);
      }

      const env = ctx.io.env;
      ensureDirs(env);
      const feed = feedDir(env);
      const dir = join(feed, id);
      const cardPath = join(dir, CARD_DEF_FILE);
      const dataPath = join(dir, DEFAULT_DATA_FILE);
      const suffix = randomBytes(4).toString('hex');

      if (existsSync(dir)) {
        if (!opts.force) throw new CliError(`error: card "${id}" already exists (use --force to rewrite card.json)`, 1, ERROR_CODES.CARD_EXISTS);
        const tmp = join(dir, `.${CARD_DEF_FILE}.${suffix}.tmp`);
        try {
          writeFileSync(tmp, cardText, { mode: 0o600 });
          renameSync(tmp, cardPath);
        } finally {
          rmSync(tmp, { force: true });
        }
      } else {
        const tmpDir = join(feed, `.new-${id}-${suffix}`);
        try {
          mkdirSync(tmpDir, { mode: 0o700 });
          writeFileSync(join(tmpDir, CARD_DEF_FILE), cardText, { mode: 0o600 });
          if (opts.withExample) writeFileSync(join(tmpDir, DEFAULT_DATA_FILE), json(example.data), { mode: 0o600 });
          renameSync(tmpDir, dir);
        } finally {
          rmSync(tmpDir, { recursive: true, force: true });
        }
      }

      const sync = syncSchemas(env, packageAssets());
      for (const w of sync.warnings) ctx.io.stderr(`warning: ${w}\n`);
      if (opts.json) {
        ctx.io.stdout(json({ id, dir, cardPath, dataPath, schemasSynced: sync.synced }));
        return;
      }
      ctx.io.stdout(`created ${dir}\nnext: write ${dataPath} (example: crontick-dashboard templates ${type})\n`);
    });
}
