import { readFile, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { Command } from 'commander';
import { CARD_DEF_FILE, DEFAULT_DATA_FILE } from '../../constants/contract.js';
import { ERROR_CODES } from '../../constants/error-codes.js';
import {
  parseCardDef,
  validateAlertFile,
  validateCardFolder,
  type AlertResult,
  type DefResult,
  type FolderIssue,
  type FolderResult,
} from '../../contract/folder-validate.js';
import { isRegisteredType, registry } from '../../contract/registry.js';
import { readAndValidateCardFolder } from '../../feed/read-card-folder.js';
import { errnoCode } from '../../utils/errors.js';
import { CliError, type CliContext } from '../io.js';

type AnyResult = FolderResult | AlertResult | DefResult;
type As = 'card' | 'data' | 'alert';
const AS_VALUES: readonly As[] = ['card', 'data', 'alert'];

function issueLines(issues: FolderIssue[]): string[] {
  return issues.map((i) => `  ${i.path === '' ? '(card)' : i.path}: ${i.message}`);
}

function render(r: AnyResult): string {
  if (r.status === 'broken') return [`BROKEN ${r.reason}: ${r.message}`, ...issueLines(r.issues)].join('\n');
  if (r.status === 'skipped') return [`SKIPPED ${r.reason}: ${r.message}`, ...issueLines(r.issues)].join('\n');
  let head: string;
  if ('alert' in r) head = `OK ${r.alert.id} (alert)`;
  else if ('card' in r) {
    head = r.status === 'no-data' ? `NO DATA ${r.card.id} (${r.card.type})` : `OK ${r.card.id} (${r.card.type})`;
  } else head = `OK ${r.id} (${r.def.type})`;
  const lines = [head];
  if (r.status === 'no-data') lines.push('  note: write data.json');
  for (const w of r.warnings) lines.push(`  warning: ${w}`);
  return lines.join('\n');
}

const isFailure = (r: AnyResult): boolean => r.status === 'broken' || r.status === 'skipped';

function unreadable(path: string, e: unknown): CliError {
  return new CliError(`error: cannot read ${path} (${errnoCode(e) ?? 'EIO'})`, 2, ERROR_CODES.FILE_UNREADABLE);
}

async function validatePath(path: string): Promise<AnyResult> {
  let st;
  try {
    st = await stat(path);
  } catch (e) {
    throw unreadable(path, e);
  }
  if (st.isDirectory()) return readAndValidateCardFolder(path).result;
  const name = basename(path);
  if (name === CARD_DEF_FILE || name === DEFAULT_DATA_FILE) return readAndValidateCardFolder(dirname(path)).result;
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    throw unreadable(path, e);
  }
  return validateAlertFile({ name, text, mtimeMs: st.mtimeMs });
}

function validateStdin(text: string, as: As, opts: { type?: string; id?: string }): AnyResult {
  const id = opts.id ?? 'stdin';
  if (as === 'alert') return validateAlertFile({ name: `${id}.json`, text, mtimeMs: Date.now() });
  if (as === 'card') return parseCardDef(id, text);
  const type = opts.type;
  if (type === undefined) {
    throw new CliError('error: --as data requires --type <type>', 2, ERROR_CODES.INVALID_OPTION);
  }
  if (!isRegisteredType(type)) {
    throw new CliError(`error: unknown type "${type}" (valid types: ${Object.keys(registry).join(', ')})`, 2, ERROR_CODES.UNKNOWN_TYPE);
  }
  const cardText = JSON.stringify({ type, title: id });
  return validateCardFolder({ folderId: id, cardText, data: { text, mtimeMs: Date.now() } });
}

export function registerValidate(program: Command, ctx: CliContext): void {
  program
    .command('validate')
    .description('Validate a card folder, card.json/data.json, or alert file (use "-" for stdin with --as)')
    .argument('<path...>', 'card folder, card.json, data.json, alert .json file, or - for stdin')
    .option('--json', 'print an array of {path, result} (validator result verbatim)')
    .option('--as <what>', 'stdin document kind: card, data or alert (required with -)')
    .option('--type <type>', 'card type, required for --as data')
    .option('--id <id>', 'id used for stdin documents (default: stdin)')
    .action(async (paths: string[], opts: { json?: boolean; as?: string; type?: string; id?: string }) => {
      const stdinCount = paths.filter((p) => p === '-').length;
      if (stdinCount > 1 || (stdinCount === 1 && paths.length > 1)) {
        throw new CliError('error: "-" (stdin) takes exactly one document per call', 2, ERROR_CODES.INVALID_OPTION);
      }
      if (stdinCount === 0 && opts.as !== undefined) {
        throw new CliError('error: --as only applies to stdin ("-")', 2, ERROR_CODES.INVALID_OPTION);
      }
      let as: As | undefined;
      if (opts.as !== undefined) {
        if (!AS_VALUES.includes(opts.as as As)) {
          throw new CliError(`error: --as must be one of ${AS_VALUES.join(', ')}`, 2, ERROR_CODES.INVALID_OPTION);
        }
        as = opts.as as As;
      }
      if (stdinCount === 1 && as === undefined) {
        throw new CliError('error: reading stdin requires --as card|data|alert', 2, ERROR_CODES.INVALID_OPTION);
      }

      const out: { path: string; result: AnyResult }[] = [];
      for (const path of paths) {
        const result =
          path === '-' ? validateStdin(await ctx.io.readStdin(), as!, opts) : await validatePath(path);
        out.push({ path, result });
      }
      if (opts.json) ctx.io.stdout(`${JSON.stringify(out, null, 2)}\n`);
      else {
        for (const { path, result } of out) {
          if (paths.length > 1) ctx.io.stdout(`# ${path}\n`);
          ctx.io.stdout(`${render(result)}\n`);
        }
      }
      ctx.setExitCode(out.some((o) => isFailure(o.result)) ? 1 : 0);
    });
}
