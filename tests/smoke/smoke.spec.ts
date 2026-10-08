/**
 * Browser smoke: boots the server from source on a fixture feed (templates/<type>/ card folders plus a
 * broken card, an alert and the SKILL.md email-summary table) against the built UI (ui/dist) and drives it in Chromium.
 * Asserts every fixture type renders its real body (04 registry), never the
 * "Unsupported type" fallback.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FakeNotifyAdapter } from '../../src/integrations/notify/fake.js';
import { startServer, type RunningServer } from '../../src/http/server.js';
import { ensureDirs, feedDir } from '../../src/paths.js';
import { ENV_HOME } from '../../src/constants/env.js';

const ROOT = resolve(import.meta.dirname, '../..');
const UI_DIR = join(ROOT, 'ui/dist');
const TYPES = ['markdown', 'table', 'list', 'kpi', 'media'] as const;

interface Harness {
  server: RunningServer;
  home: string;
}

interface FixtureCard {
  id: string;
  card: Record<string, unknown>;
  /** data.json text or object; omitted = no data.json */
  data?: unknown;
}

function writeAtomic(file: string, text: string): void {
  writeFileSync(`${file}.tmp`, text);
  renameSync(`${file}.tmp`, file);
}

async function boot(cards: FixtureCard[], alerts: Record<string, unknown>[] = []): Promise<Harness> {
  const home = mkdtempSync(join(tmpdir(), 'crontick-smoke-'));
  const env = { ...process.env, [ENV_HOME]: home };
  ensureDirs(env);
  for (const c of cards) {
    const dir = join(feedDir(env), c.id);
    mkdirSync(dir, { recursive: true });
    writeAtomic(join(dir, 'card.json'), JSON.stringify(c.card));
    if (c.data !== undefined) writeAtomic(join(dir, 'data.json'), typeof c.data === 'string' ? c.data : JSON.stringify(c.data));
  }
  if (alerts.length > 0) {
    mkdirSync(join(feedDir(env), 'alerts'), { recursive: true });
    for (const a of alerts) writeAtomic(join(feedDir(env), 'alerts', `${String(a['id'])}.json`), JSON.stringify({ ...a, id: undefined }));
  }
  const server = await startServer({ env, uiDir: UI_DIR, port: 0, notifyAdapter: new FakeNotifyAdapter() });
  return { server, home };
}

async function shutdown(h: Harness | undefined): Promise<void> {
  if (!h) return;
  await h.server.stop();
  rmSync(h.home, { recursive: true, force: true });
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

const readJson = (...parts: string[]): Record<string, unknown> =>
  JSON.parse(readFileSync(join(ROOT, ...parts), 'utf8')) as Record<string, unknown>;

/** Shipped templates/<type>/{card,data}.json as a fixture card (folder name = type). */
const template = (type: string): FixtureCard => ({
  id: type,
  card: readJson('templates', type, 'card.json'),
  data: { ...readJson('templates', type, 'data.json'), updatedAt: new Date().toISOString() },
});

/** The email-summary data.json block from SKILL.md (the doc an agent is told to write). */
function skillBlock(kind: 'card' | 'data'): Record<string, unknown> {
  const md = readFileSync(join(ROOT, 'src/skill/SKILL.md'), 'utf8');
  const m = new RegExp(`<!-- example:${kind} email-summary -->\\s*\`\`\`json\\n([\\s\\S]*?)\`\`\``).exec(md);
  if (!m) throw new Error(`SKILL.md has no ${kind} example`);
  return JSON.parse(m[1]!) as Record<string, unknown>;
}

test.describe('populated feed', () => {
  let h: Harness | undefined;
  test.beforeAll(async () => {
    const cards: FixtureCard[] = TYPES.map(template);
    cards.push({
      id: 'smoke-broken',
      card: { type: 'markdown', title: 'Smoke broken' },
      data: { updatedAt: '2026-10-05T07:30:00Z', error: 'Upstream API unreachable' },
    });
    h = await boot(cards, [{ id: 'smoke-alert', title: 'Smoke alert', text: 'Disk almost full', priority: 5 }]);
  });
  test.afterAll(() => shutdown(h));

  test('ui/dist is served by 02 (index + assets)', async ({ request }) => {
    const url = h!.server.url;
    const res = await request.get(url);
    expect(res.status()).toBe(200);
    const html = await res.text();
    const assets = [...html.matchAll(/(?:src|href)="(\.?\/?assets\/[^"]+)"/g)].map((m) => m[1]!);
    expect(assets.length).toBeGreaterThan(0);
    for (const a of assets) {
      const r = await request.get(new URL(a, url.endsWith('/') ? url : `${url}/`).toString());
      expect(r.status(), a).toBe(200);
    }
  });

  test('renders cards, broken, alert, done and reopen with no console errors', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(h!.server.url);

    // One rendered card element per fixture type (folder name = type).
    for (const type of TYPES) await expect(page.locator(`[data-card-id="${type}"]`).first(), type).toBeVisible();
    // Three columns: left | center | right placement comes from each template's card.json layout.
    await expect(page.locator('[data-column="left"] [data-card-id="table"]')).toBeVisible();
    await expect(page.locator('[data-column="center"] [data-card-id="markdown"]')).toBeVisible();
    await expect(page.locator('[data-column="right"] [data-card-id="kpi"]')).toBeVisible();
    // Collapsed panels render as chips; expand them all so the real bodies mount.
    const expanders = page.getByRole('button', { name: /^Expand/ });
    while (await expanders.count()) await expanders.first().click();
    await expect(page.getByText(/Unsupported type/i)).toHaveCount(0);
    await expect(page.locator('table').first()).toBeVisible(); // table body
    await expect(page.locator('[data-card-id] a.card-link').first()).toBeVisible(); // list/markdown links

    // Broken card: message shown, no data/body of its own.
    const broken = page.locator('[data-card-id="smoke-broken"]');
    await expect(broken).toBeVisible();
    await expect(broken.getByText('Upstream API unreachable')).toBeVisible();
    await expect(broken.getByRole('group', { name: 'Broken card' })).toBeVisible();
    await expect(broken.getByText(/Unsupported type/i)).toHaveCount(0);

    // Alert strip.
    const alerts = page.getByRole('region', { name: 'Alerts' });
    await expect(alerts.locator('[data-alert-id="smoke-alert"]')).toBeVisible();

    // Done on a panel moves it to the Completed section; Reopen brings it back.
    const id = 'table';
    const panel = page.locator(`section[data-card-id="${id}"]`);
    await panel.getByRole('button', { name: 'Done' }).click();
    const completed = page.getByTestId('completed');
    await expect(completed).toBeVisible();
    const head = completed.getByRole('button', { name: /^Completed/ });
    if ((await head.getAttribute('aria-expanded')) === 'false') await head.click();
    const row = completed.locator(`[data-completed-id="${id}"]`);
    await expect(row).toBeVisible();
    await expect(panel).toHaveCount(0);
    await row.getByRole('button', { name: 'Reopen' }).click();
    await expect(page.locator(`section[data-card-id="${id}"]`)).toBeVisible();

    expect(errors).toEqual([]);
  });
});

test.describe('SKILL.md email-summary table', () => {
  let h: Harness | undefined;
  test.beforeAll(async () => {
    h = await boot([{ id: 'email-summary', card: skillBlock('card'), data: skillBlock('data') }]);
  });
  test.afterAll(() => shutdown(h));

  test('renders the documented table card in the center column', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(h!.server.url);
    const card = page.locator('[data-column="center"] [data-card-id="email-summary"]');
    await expect(card).toBeVisible();
    await expect(card.getByRole('columnheader', { name: /From/ })).toBeVisible();
    await expect(card.getByRole('columnheader', { name: /Subject/ })).toBeVisible();
    await expect(card.locator('tbody tr')).toHaveCount(5);
    await expect(card.getByText('Q4 planning notes', { exact: true })).toBeVisible();
    await expect(card.getByText(/Unsupported type|No data yet/i)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('empty feed', () => {
  let h: Harness | undefined;
  test.beforeAll(async () => {
    h = await boot([]);
  });
  test.afterAll(() => shutdown(h));

  test('shows the empty state with no console errors', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(h!.server.url);
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await expect(page.getByText('No cards yet')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

