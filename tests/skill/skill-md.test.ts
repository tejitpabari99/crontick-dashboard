import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run, type CliIo } from '../../src/cli/main.js';
import { listTypes } from '../../src/contract/index.js';

const root = join(import.meta.dirname, '..', '..');
const md = readFileSync(join(root, 'src', 'skill', 'SKILL.md'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };

async function commandNames(): Promise<string[]> {
  let out = '';
  const io: CliIo = { stdout: (s) => void (out += s), stderr: (s) => void (out += s), readStdin: async () => '', env: {}, isTTY: false };
  await run(['--help'], io);
  const after = out.split(/^Commands:\s*$/m)[1] ?? '';
  return [...after.matchAll(/^\s{2}([a-z][\w-]*)/gm)].map((m) => m[1]!);
}

describe('SKILL.md', () => {
  it('has frontmatter with name, trigger-phrase description, allowed-tools', () => {
    const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
    expect(m).not.toBeNull();
    const fm = m![1]!;
    expect(fm).toMatch(/^name: crontick-dashboard$/m);
    expect(fm).toMatch(/^allowed-tools: shell$/m);
    const desc = /^description: (.+)$/m.exec(fm)?.[1] ?? '';
    for (const p of ['show on my dashboard', 'write a dashboard card', 'raise an alert', 'notify me']) expect(desc).toContain(p);
  });

  it('header comment version matches package.json', () => {
    expect(md).toContain(`<!-- crontick-dashboard@${pkg.version} -->`);
  });

  it('names every registered type, and only registered types after `templates`', () => {
    for (const t of listTypes()) expect(md).toContain(`\`${t}\``);
    for (const m of md.matchAll(/templates <?([a-z][\w-]*)>?/g)) {
      const w = m[1]!;
      if (w !== 'type') expect(listTypes()).toContain(w);
    }
    for (const m of md.matchAll(/"kind":\s*"\w+",\s*"type":\s*"([^"]+)"/g)) expect(listTypes()).toContain(m[1]);
  });

  it('every backticked `crontick-dashboard <cmd>` is a real command', async () => {
    const cmds = await commandNames();
    expect(cmds).toEqual(expect.arrayContaining(['validate', 'templates', 'info', 'start', 'daemon', 'skill']));
    const used = [...md.matchAll(/`crontick-dashboard ([a-z][\w-]*)/g)].map((m) => m[1]!);
    expect(used).toEqual(expect.arrayContaining(['info', 'validate', 'templates']));
    for (const u of used) expect(cmds).toContain(u);
  });

  it('contains required guidance', () => {
    const required: [string, RegExp][] = [
      ['info --json feedDir', /info --json[\s\S]*feedDir|feedDir[\s\S]*info --json/],
      ['never guess path', /never guess/i],
      ['tmp+rename', /\.json\.tmp[\s\S]*rename/],
      ['validate before write', /validate[\s\S]{0,300}before[\s\S]{0,40}writ|before writing[\s\S]{0,200}validate/i],
      ['read existing card', /read (the )?existing card/i],
      ['act on checked: true', /`checked: true`/],
      ['for omitted = end of day', /`for` omitted[^\n]*end of (the|that) (local )?day/i],
      ['no show = always visible', /no `show`[^\n]*always visible/i],
      ['alerts honor show', /alerts? honou?r `?show/i],
      ['cell-link email table', /Unsubscribe[\s\S]*"link"|"link"[\s\S]*Unsubscribe/],
      ['due', /`due`/],
      ['important tasks only', /only the important/i],
      ['single-unit durations', /single-unit/i],
      ['link schemes', /http\|https\|mailto\|ms-outlook/],
      ['kpi data.items', /`data\.items`/],
      ['error on failure', /error: "/],
      ['id equals filename', /filename stem/i],
    ];
    for (const [name, re] of required) expect(re.test(md), name).toBe(true);
  });
});
