import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '../src/api/client.ts';
import { createMutations } from '../src/api/mutations.ts';
import { createSnapshotStore } from '../src/api/store.ts';
import { createToastStore } from '../src/api/toasts.ts';
import { AlertStrip } from '../src/zones/AlertStrip.tsx';
import { snapshotOf, valert } from './helpers/snapshot.ts';

afterEach(cleanup);
const noop = () => {};

describe('AlertStrip', () => {
  it('renders nothing when empty', () => {
    const { container } = render(<AlertStrip alerts={[]} nowPriorityThreshold={5} onTick={noop} />);
    expect(container.firstChild).toBeNull();
  });

  it('region with aria attrs and one li per alert', () => {
    render(<AlertStrip alerts={[valert('a'), valert('b'), valert('c')]} nowPriorityThreshold={5} onTick={noop} />);
    const r = screen.getByRole('region', { name: 'Alerts' });
    expect(r.getAttribute('aria-live')).toBe('polite');
    expect(within(r).getAllByRole('listitem')).toHaveLength(3);
  });

  it('omits missing text/link and their separators', () => {
    render(
      <AlertStrip
        alerts={[
          valert('t', { title: 'Only', priority: 1 }),
          valert('x', { title: 'TextOnly', text: 'hello' }),
          valert('l', { title: 'LinkOnly', link: 'https://e.com' }),
          valert('b', { title: 'Both', text: 'tt', link: 'https://e.com' }),
        ]}
        nowPriorityThreshold={5}
        onTick={noop}
      />,
    );
    const seps = (id: string) => document.querySelector(`[data-alert-id="${id}"]`)!.querySelectorAll('.alert-strip__sep').length;
    expect([seps('t'), seps('x'), seps('l'), seps('b')]).toEqual([0, 1, 1, 2]);
    const text = screen.getByText('hello');
    expect(text.getAttribute('title')).toBe('hello');
    expect(text.className).toContain('clamp-1');
    expect(document.querySelectorAll('a[href="https://e.com"]')).toHaveLength(2);
    expect(document.querySelector('[data-alert-id="t"] a')).toBeNull();
  });

  it('broken alert shows copy with message, title kept, tick still works', () => {
    const onTick = vi.fn();
    render(
      <AlertStrip
        alerts={[valert('bad', { title: 'bad', status: 'broken', message: 'oops' })]}
        nowPriorityThreshold={5}
        onTick={onTick}
      />,
    );
    expect(screen.getByText('Broken alert file: oops')).toBeTruthy();
    expect(screen.getByText('bad')).toBeTruthy();
    expect(document.querySelector('.alert-strip__row--broken')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /tick/i }));
    expect(onTick).toHaveBeenCalledWith('bad');
  });

  it('tick calls the mutation and optimistically removes the row', async () => {
    const snap = snapshotOf([], { alerts: ['a1', 'a2'] }, { alertItems: [valert('a1'), valert('a2')] });
    const fetchFn = vi.fn<typeof fetch>(async (input) =>
      String(input) === '/api/snapshot'
        ? new Response(JSON.stringify(snap), { status: 200, headers: { ETag: 'e' } })
        : new Promise<Response>(() => {}),
    );
    const store = createSnapshotStore({ client: createClient({ fetch: fetchFn }), doc: undefined });
    const m = createMutations({ store, toasts: createToastStore(), fetch: fetchFn });
    await store.refetch();
    const view = () =>
      m.getView().state.snapshot!.alerts.map((id) => m.getView().state.snapshot!.alertItems[id]!);
    const { rerender } = render(<AlertStrip alerts={view()} nowPriorityThreshold={5} onTick={(id) => void m.tick(id)} />);
    await act(async () => {
      fireEvent.click(within(document.querySelector('[data-alert-id="a1"]') as HTMLElement).getByRole('button'));
    });
    expect(fetchFn.mock.calls.some(([u]) => String(u) === '/api/alerts/a1/tick')).toBe(true);
    rerender(<AlertStrip alerts={view()} nowPriorityThreshold={5} onTick={(id) => void m.tick(id)} />);
    expect(document.querySelector('[data-alert-id="a1"]')).toBeNull();
    expect(document.querySelector('[data-alert-id="a2"]')).not.toBeNull();
  });
});
