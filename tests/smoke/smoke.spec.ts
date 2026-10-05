/**
 * Browser smoke: boots 02's server from source on a fixture feed (01 examples plus a
 * broken card and an alert) against the built UI (ui/dist) and drives it in Chromium.
 * Asserts every fixture type renders its real body (04 registry), never the
 * "Unsupported type" fallback.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FakeNotifyAdapter } from '../../src/integrations/notify/fake.js';
import { startServer, type RunningServer } from '../../src/http/server.js';
import { ensureDirs, feedDir } from '../../src/paths.js';

const ROOT = resolve(import.meta.dirname, '../..');
const UI_DIR = join(ROOT, 'ui/dist');
const TYPES = ['markdown', 'table', 'list', 'kpi', 'media'] as const;

interface Harness {
  server: RunningServer;
  home: string;
}

async function boot(cards: Record<string, unknown>[]): Promise<Harness> {
  const home = mkdtempSync(join(tmpdir(), 'crontick-smoke-'));
  const env = { ...process.env, CRONTICK_DASHBOARD_HOME: home };
  ensureDirs(env);
  for (const card of cards) {
    const file = join(feedDir(env), `${String(card['id'])}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify(card));
    renameSync(`${file}.tmp`, file);
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

const example = (type: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(ROOT, 'templates', `${type}.example.json`), 'utf8')) as Record<string, unknown>;

const card = (card: Record<string, unknown>, over: Record<string, unknown>) => ({ ...card, ...over });

test.describe('populated feed', () => {
  let h: Harness | undefined;
  test.beforeAll(async () => {
    const cards = TYPES.map(example);
    // Panels only: ensure examples are panels so the alert/broken ones are the only others.
    const base = cards.map((c) => card(c, { kind: 'panel', priority: 1, updatedAt: new Date().toISOString() }));
    base.push(
      card(example('markdown'), {
        id: 'smoke-alert',
        kind: 'alert',
        title: 'Smoke alert',
        priority: 5,
        data: { text: 'Disk almost full' },
      }),
      {
        id: 'smoke-broken',
        kind: 'panel',
        type: 'markdown',
        title: 'Smoke broken',
        updatedAt: '2026-10-05T07:30:00Z',
        error: 'Upstream API unreachable',
      },
    );
    h = await boot(base);
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

    // One rendered card element per fixture type (ids come from the 01 examples).
    for (const type of TYPES) {
      const id = String(example(type)['id']);
      await expect(page.locator(`[data-card-id="${id}"]`).first(), type).toBeVisible();
    }
    // Collapsed panels render as chips; expand them all so the real bodies mount.
    const expanders = page.getByRole('button', { name: 'Expand' });
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
    await expect(alerts.locator('[data-card-id="smoke-alert"]')).toBeVisible();

    // Done on a panel, then reopen from the tray chip.
    const id = String(example('table')['id']);
    const panel = page.locator(`section[data-card-id="${id}"]`);
    const expand = panel.getByRole('button', { name: 'Expand' });
    if (await expand.count()) await expand.click(); // collapsed examples render as chips
    await panel.getByRole('button', { name: 'Done' }).click();
    const tray = page.getByTestId('done-tray');
    const chip = tray.locator(`[data-card-id="${id}"]`);
    await expect(chip).toBeVisible();
    await expect(panel).toHaveCount(0);
    await chip.click();
    await expect(page.locator(`section[data-card-id="${id}"]`)).toBeVisible();
    await expect(page.getByTestId('done-tray')).toHaveCount(0);

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

