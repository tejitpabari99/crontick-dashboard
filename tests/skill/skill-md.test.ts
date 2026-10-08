import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run, type CliIo } from '../../src/cli/main.js';
import { listTypes, parseCardDef, validateAlertFile, validateCardFolder } from '../../src/contract/index.js';

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

  it('names every registered type, and only registered types or alert after `templates`', () => {
    for (const t of listTypes()) expect(md).toContain(`\`${t}\``);
    const known = [...listTypes(), 'alert'];
    for (const m of md.matchAll(/templates <?([a-z][\w-]*)>?/g)) {
      const w = m[1]!;
      if (w !== 'type') expect(known).toContain(w);
    }
  });

  it('every backticked `crontick-dashboard <cmd>` is a real command', async () => {
    const cmds = await commandNames();
    expect(cmds).toEqual(expect.arrayContaining(['validate', 'templates', 'info', 'new', 'start', 'daemon', 'skill']));
    const shBlocks = [...md.matchAll(/```sh\n([\s\S]*?)```/g)].map((m) => m[1]!).join('\n');
    const code = `${[...md.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!).join('\n')}\n${shBlocks}`;
    const used = [...code.matchAll(/crontick-dashboard ([a-z][\w-]*)/g)].map((m) => m[1]!);
    expect(used).toEqual(expect.arrayContaining(['info', 'validate', 'templates', 'new']));
    for (const u of used) expect(cmds).toContain(u);
  });

  it('marked example JSON blocks validate through the contract validators', () => {
    const blocks = [...md.matchAll(/<!-- example:(card|data|alert) ([\w-]+) -->\n```json\n([\s\S]*?)\n```/g)].map((m) => ({
      kind: m[1]!,
      id: m[2]!,
      text: m[3]!,
    }));
    expect(blocks.map((b) => b.kind).sort()).toEqual(['alert', 'card', 'data']);
    const card = blocks.find((b) => b.kind === 'card')!;
    const data = blocks.find((b) => b.kind === 'data')!;
    const alert = blocks.find((b) => b.kind === 'alert')!;
    expect(parseCardDef(card.id, card.text).status).toBe('ok');
    const folder = validateCardFolder({ folderId: card.id, cardText: card.text, data: { text: data.text, mtimeMs: Date.now() } });
    expect(folder.status).toBe('ok');
    expect(JSON.parse(alert.text)).not.toHaveProperty('text');
    const a = validateAlertFile({ name: `${alert.id}.json`, text: alert.text, mtimeMs: Date.now() });
    expect(a.status).toBe('ok');
  });

  it('does not mention removed concepts', () => {
    for (const w of ['kind', 'size', 'retention', 'archive']) expect(md, w).not.toMatch(new RegExp(`\\b${w}\\b`, 'i'));
  });

  it('contains required guidance', () => {
    const required: [string, RegExp][] = [
      ['info --json feedDir', /info --json[\s\S]*feedDir|feedDir[\s\S]*info --json/],
      ['never guess path', /never guess/i],
      ['tmp+rename', /data\.json\.tmp[\s\S]*rename/],
      ['pre-validate', /validate - --as data --type/],
      ['post-validate folder', /validate <feedDir>\/<id>/],
      ['read data.json first', /read data\.json first/i],
      ['act on checked: true', /`checked: true`/],
      ['for omitted = end of day', /`for` omitted[^\n]*end of (the|that) (local )?day/i],
      ['no show = always visible', /no `show`[^\n]*always visible/i],
      ['alerts honor show', /alerts? honou?r `?show/i],
      ['alerts dir', /alerts\/<id>\.json/],
      ['alert text optional', /`text`: optional/],
      ['ticked alert completed', /ticked alert moves to Completed/],
      ['due', /`due`/],
      ['single-unit durations', /single-unit/i],
      ['link schemes', /http\|https\|mailto\|ms-outlook/],
      ['kpi data.items', /`data\.items`/],
      ['error on failure', /error: "/],
      ['plain file name rule', /plain file name[\s\S]*no subfolders/],
    ];
    for (const [name, re] of required) expect(re.test(md), name).toBe(true);
  });
});
