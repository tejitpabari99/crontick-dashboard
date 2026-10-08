import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run, type CliIo } from '../../src/cli/main.js';
import { ENV_HOME } from '../../src/constants/env.js';
import { startServer, type RunningServer } from '../../src/http/server.js';
import { FakeNotifyAdapter } from '../../src/integrations/notify/fake.js';
import type { Snapshot } from '../../src/shared/api-types.js';
import { loopbackUrl } from '../../src/utils/loopback.js';

const root = join(import.meta.dirname, '..', '..');
const skill = readFileSync(join(root, 'src', 'skill', 'SKILL.md'), 'utf8');

/** Body of the fenced json block that follows `<!-- example:<kind> <id> -->` in SKILL.md. */
function example(kind: string, id: string): string {
  const m = new RegExp(`<!-- example:${kind} ${id} -->\\s*\`\`\`json\\n([\\s\\S]*?)\`\`\``).exec(skill);
  if (!m) throw new Error(`SKILL.md has no example:${kind} ${id} block`);
  return m[1]!;
}

let home: string;
let ui: string;
let server: RunningServer | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ct-accept-'));
  ui = mkdtempSync(join(tmpdir(), 'ct-accept-ui-'));
  writeFileSync(join(ui, 'index.html'), '<html></html>');
});
afterEach(async () => {
  await server?.stop();
  server = undefined;
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  rmSync(ui, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function cli(args: string[], stdin = ''): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: CliIo = {
    stdout: (s) => void (out += s),
    stderr: (s) => void (err += s),
    readStdin: async () => stdin,
    env: { [ENV_HOME]: home },
    isTTY: false,
  };
  const code = await run(args, io);
  return { code, out, err };
}

const snap = async (s: RunningServer): Promise<Snapshot> =>
  (await (await fetch(`${loopbackUrl(s.port)}/api/snapshot`)).json()) as Snapshot;

async function until<T>(fn: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const v = await fn();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('condition not met within 5s');
}

describe('SKILL.md acceptance: an agent following the skill literally gets a card on the dashboard', () => {
  it('info -> new -> pre-validate -> no data -> atomic write -> validate -> snapshot ok', async () => {
    // 1. Never guess the feed path: info --json.
    const info = await cli(['info', '--json']);
    expect(info.code).toBe(0);
    const { feedDir } = JSON.parse(info.out) as { feedDir: string };
    expect(feedDir).toBe(join(home, 'feed'));

    server = await startServer({ env: { [ENV_HOME]: home }, uiDir: ui, port: 0, notifyAdapter: new FakeNotifyAdapter() });

    // 2. First time: create the card (command exactly as written in SKILL.md section 11).
    expect(skill).toContain("crontick-dashboard new email-summary --type table --title 'Email summary' --column center --height M");
    const created = await cli(['new', 'email-summary', '--type', 'table', '--title', 'Email summary', '--column', 'center', '--height', 'M']);
    expect(created.code, created.err).toBe(0);
    const folder = join(feedDir, 'email-summary');
    expect(JSON.parse(readFileSync(join(folder, 'card.json'), 'utf8'))).toEqual(JSON.parse(example('card', 'email-summary')));

    // 3. Pre-validate the SKILL.md data block via stdin.
    const dataText = example('data', 'email-summary');
    const pre = await cli(['validate', '-', '--as', 'data', '--type', 'table'], dataText);
    expect(pre.code, pre.out + pre.err).toBe(0);

    // 4. Before the write the snapshot shows "no data".
    const before = await until(async () => {
      const s = await snap(server!);
      return s.cards['email-summary'] ? s : undefined;
    });
    expect(before.cards['email-summary']!.status).toBe('no-data');
    expect(before.cards['email-summary']!.data).toBeUndefined();

    // 5. Atomic write: data.json.tmp, then rename.
    writeFileSync(join(folder, 'data.json.tmp'), dataText);
    renameSync(join(folder, 'data.json.tmp'), join(folder, 'data.json'));

    // 6. validate <folder>: exit 0, no warnings.
    const post = await cli(['validate', folder]);
    expect(post.code, post.out + post.err).toBe(0);
    expect(post.out).toMatch(/^OK email-summary \(table\)/);
    expect(post.out).not.toContain('warning');

    // 7. The running server shows the card: center column, ok, rows present.
    const after = await until(async () => {
      const s = await snap(server!);
      return s.cards['email-summary']?.status === 'ok' ? s : undefined;
    });
    const view = after.cards['email-summary']!;
    expect(after.columns.center).toContain('email-summary');
    expect(view.column).toBe('center');
    expect(view.type).toBe('table');
    const rows = (view.data as { rows?: unknown[] }).rows;
    expect(rows).toHaveLength(5);
  });
});
