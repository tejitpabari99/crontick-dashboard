import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Command } from 'commander';
import { validateCardFile, type ValidationResult } from '../../contract/index.js';
import { CliError, type CliContext } from '../io.js';

function render(r: ValidationResult): string {
  if ('broken' in r) {
    const lines = [`BROKEN ${r.reason}: ${r.message}`];
    for (const i of r.issues) lines.push(`  ${i.path === '' ? '(card)' : i.path}: ${i.message}`);
    return lines.join('\n');
  }
  const lines = [`OK ${r.card.id} (${r.card.type}, ${r.card.kind})`];
  for (const w of r.warnings) lines.push(`  warning: ${w}`);
  return lines.join('\n');
}

export function registerValidate(program: Command, ctx: CliContext): void {
  program
    .command('validate')
    .description('Validate card files before writing them to the feed dir (use "-" for stdin)')
    .argument('<file...>', 'card JSON files, or - for stdin')
    .option('--json', 'print an array of {file, result} (ValidationResult verbatim)')
    .action(async (files: string[], opts: { json?: boolean }) => {
      const out: { file: string; result: ValidationResult }[] = [];
      for (const file of files) {
        let text: string;
        let filename: string | undefined;
        if (file === '-') {
          text = await ctx.io.readStdin();
        } else {
          try {
            text = await readFile(file, 'utf8');
          } catch (e) {
            const code = (e as NodeJS.ErrnoException).code ?? 'EIO';
            throw new CliError(`error: cannot read ${file} (${code})`, 2);
          }
          filename = basename(file);
        }
        out.push({ file, result: validateCardFile(text, filename === undefined ? {} : { filename }) });
      }
      if (opts.json) ctx.io.stdout(`${JSON.stringify(out, null, 2)}\n`);
      else {
        for (const { file, result } of out) {
          if (files.length > 1) ctx.io.stdout(`# ${file}\n`);
          ctx.io.stdout(`${render(result)}\n`);
        }
      }
      ctx.setExitCode(out.some((o) => 'broken' in o.result) ? 1 : 0);
    });
}
