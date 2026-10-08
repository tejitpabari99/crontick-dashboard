import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { createClient } from '../src/api/client.ts';
import { createMutations } from '../src/api/mutations.ts';
import { createSnapshotStore } from '../src/api/store.ts';
import { createToastStore } from '../src/api/toasts.ts';
import type { Snapshot } from '../src/api/types.ts';
import { FILTER_KEY } from '../src/constants/storage.ts';
import { snapshotOf, valert, vcard } from './helpers/snapshot.ts';
import { registerCardType } from '../src/registry/registry.ts';

// @ts-expect-error deliberately not a 01 type name
registerCardType('zz-flt', { Component: () => <p>body</p>, searchText: () => '' });

function snap(over: { cards?: boolean; alerts?: boolean; hidden?: boolean } = {}): Snapshot {
  const { cards = true, alerts = true, hidden = true } = over;
  const all = [
    vcard('c1', 'zz-flt', { title: 'CenterCard' }),
    vcard('n1', 'zz-flt', { title: 'NowCard' }),
    vcard('h1', 'zz-flt', { title: 'HidCard' }),
  ];
  const s = snapshotOf(
    all,
    {
      center: cards ? ['c1'] : [],
      now: cards ? ['n1'] : [],
      hidden: hidden ? ['h1'] : [],
      alerts: alerts ? ['al'] : [],
    },
    { alertItems: [valert('al', { title: 'AlertRow' })] }
  );
  return s;
}

function mount(s: Snapshot = snap()) {
  const fetchFn = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(s), { status: 200, headers: { ETag: 'e' } })
  );
  const store = createSnapshotStore({ client: createClient({ fetch: fetchFn }), doc: undefined });
  const toasts = createToastStore();
  const mutations = createMutations({ store, toasts, fetch: fetchFn });
  return render(<App mutations={mutations} toasts={toasts} />);
}
const radio = (n: string) => screen.getByRole('radio', { name: n });

beforeEach(() => {
  localStorage.clear();
  document.title = '';
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('header filter', () => {
  it('defaults to All and shows strip, Now, columns', async () => {
    mount();
    await screen.findByText('CenterCard');
    expect(screen.getByRole('radiogroup')).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(radio('All').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('AlertRow')).toBeTruthy();
    expect(screen.getByText('NowCard')).toBeTruthy();
  });

  it('Alerts hides columns and Now, keeps the strip', async () => {
    mount();
    await screen.findByText('CenterCard');
    fireEvent.click(radio('Alerts'));
    expect(radio('Alerts').getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByTestId('columns')).toBeNull();
    expect(screen.queryByText('CenterCard')).toBeNull();
    expect(screen.queryByText('NowCard')).toBeNull();
    expect(screen.getByText('AlertRow')).toBeTruthy();
  });

  it('Cards hides the strip, keeps Now and columns', async () => {
    mount();
    await screen.findByText('CenterCard');
    fireEvent.click(radio('Cards'));
    expect(screen.queryByText('AlertRow')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Alerts' })).toBeNull();
    expect(screen.getByText('CenterCard')).toBeTruthy();
    expect(screen.getByText('NowCard')).toBeTruthy();
  });

  it('arrow keys move the selection', async () => {
    mount();
    await screen.findByText('CenterCard');
    fireEvent.keyDown(radio('All'), { key: 'ArrowRight' });
    expect(radio('Alerts').getAttribute('aria-checked')).toBe('true');
  });

  it('persists across remount', async () => {
    const a = mount();
    await screen.findByText('CenterCard');
    fireEvent.click(radio('Cards'));
    a.unmount();
    mount();
    await screen.findByText('CenterCard');
    expect(radio('Cards').getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText('AlertRow')).toBeNull();
    expect(localStorage.getItem(FILTER_KEY)).toBe('cards');
  });

  it('works with throwing localStorage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    mount();
    await screen.findByText('CenterCard');
    expect(radio('All').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(radio('Alerts'));
    expect(radio('Alerts').getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText('CenterCard')).toBeNull();
  });

  it('Hidden popover and attention count ignore the filter', async () => {
    mount();
    await screen.findByText('CenterCard');
    await waitFor(() => expect(document.title).toBe('(1) Crontick'));
    for (const f of ['Alerts', 'Cards']) {
      fireEvent.click(radio(f));
      expect(screen.getByRole('button', { name: /hidden \(1\)/i })).toBeTruthy();
      expect(document.title).toBe('(1) Crontick');
    }
  });

  it('Cards with no cards but alerts shows the empty-cards state, not No cards yet', async () => {
    mount(snap({ cards: false, hidden: false }));
    await screen.findByText('AlertRow');
    fireEvent.click(radio('Cards'));
    expect(screen.getByTestId('empty-cards').textContent).toBe('No cards');
    expect(screen.queryByTestId('empty-state')).toBeNull();
  });

  it('Alerts with no alerts shows the empty-alerts note', async () => {
    mount(snap({ alerts: false }));
    await screen.findByText('CenterCard');
    fireEvent.click(radio('Alerts'));
    expect(screen.getByTestId('empty-alerts')).toBeTruthy();
    expect(screen.queryByTestId('empty-state')).toBeNull();
  });
});
