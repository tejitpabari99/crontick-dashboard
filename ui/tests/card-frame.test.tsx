import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewCard } from '../src/api/types.ts';
import { CardFrame, type CardFrameProps } from '../src/frame/CardFrame.tsx';
import { resetExpanded } from '../src/frame/CardFrame.tsx';
import { SEEN_KEY, markSeen } from '../src/lib/seen.ts';
import { registerCardType } from '../src/registry/registry.ts';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function card(over: Partial<ViewCard> = {}): ViewCard {
  return {
    id: 'c1',
    kind: 'panel',
    type: 'zz-frame',
    title: 'My card',
    priority: 3,
    notify: false,
    updatedAt: ago(2 * 3_600_000),
    collapsed: false,
    status: 'ok',
    data: { text: 'SECRET-DATA' },
    ...over,
  };
}

function props(over: Partial<CardFrameProps> = {}): CardFrameProps {
  return {
    card: card(),
    mode: 'grid',
    query: '',
    checked: new Set(),
    pending: new Set(),
    nowPriorityThreshold: 8,
    onItemAction: async () => {},
    onDone: vi.fn(),
    onHide: vi.fn(),
    onFullscreen: vi.fn(),
    ...over,
  };
}

function mockMatchMedia(reduced: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: reduced && q.includes('prefers-reduced-motion'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }));
}

// @ts-expect-error deliberately not a 01 type name
registerCardType('zz-frame', {
  Component: ({ data, mode }: { data: { text: string }; mode: string }) => (
    <p data-testid="body">
      {data.text}|{mode}
    </p>
  ),
  searchText: () => '',
});
// @ts-expect-error deliberately not a 01 type name
registerCardType('zz-throw', {
  Component: () => {
    throw new Error('boom');
  },
  searchText: () => '',
});

beforeEach(() => {
  localStorage.clear();
  resetExpanded();
  mockMatchMedia(false);
  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('title bar', () => {
  it('shows title with tooltip, relative time with absolute title, body via registry', () => {
    const p = props();
    render(<CardFrame {...p} />);
    expect(screen.getByText('My card').getAttribute('title')).toBe('My card');
    const rel = screen.getByText('2h ago');
    expect(rel.getAttribute('title')).toBe(new Date(p.card.updatedAt).toLocaleString());
    expect(screen.getByTestId('body').textContent).toBe('SECRET-DATA|grid');
    expect(document.querySelector('.card-frame__body')).not.toBeNull();
  });

  it('relative time ticks', () => {
    render(<CardFrame {...props({ card: card({ updatedAt: ago(59 * 60_000) }) })} />);
    expect(screen.getByText('59m ago')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('1h ago')).toBeTruthy();
  });

  it('priority marker only at/above threshold', () => {
    const { rerender } = render(<CardFrame {...props({ card: card({ priority: 7 }) })} />);
    expect(screen.queryByTestId('priority-marker')).toBeNull();
    rerender(<CardFrame {...props({ card: card({ priority: 8 }) })} />);
    expect(screen.getByTestId('priority-marker')).toBeTruthy();
  });

  it('action buttons are labelled and call back', () => {
    const p = props();
    render(<CardFrame {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(p.onFullscreen).toHaveBeenCalledWith('c1');
    expect(p.onDone).toHaveBeenCalledWith('c1');
    expect(p.onHide).toHaveBeenCalledWith('c1');
  });

  it('contains render errors', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<CardFrame {...props({ card: card({ type: 'zz-throw' }) })} />);
    expect(screen.getByText('Render error')).toBeTruthy();
    spy.mockRestore();
  });

  it('unknown type falls back', () => {
    render(<CardFrame {...props({ card: card({ type: 'holo' }) })} />);
    expect(screen.getByTestId('unknown-type')).toBeTruthy();
  });
});

describe('Broken', () => {
  it('never shows data even if supplied', () => {
    const p = props({
      card: card({ status: 'broken', reason: 'unreadable', message: 'bad feed', data: { text: 'SECRET-DATA' } }),
    });
    const { container } = render(<CardFrame {...p} />);
    expect(screen.getByText('bad feed')).toBeTruthy();
    expect(screen.queryByTestId('body')).toBeNull();
    expect(container.textContent).not.toContain('SECRET-DATA');
    expect(container.querySelector('.card-frame__body')).toBeNull();
    expect(container.querySelector('.card-frame--broken')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Hide' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
  });
});

describe('notify highlight', () => {
  const n = () => card({ notify: true });

  it('unseen notify card is highlighted; non-notify is not', () => {
    const { container, rerender } = render(<CardFrame {...props({ card: n() })} />);
    expect(container.querySelector('.card-frame--notify')).not.toBeNull();
    expect(screen.getByTestId('notify-dot')).toBeTruthy();
    rerender(<CardFrame {...props({ card: card() })} />);
    expect(container.querySelector('.card-frame--notify')).toBeNull();
  });

  it('already-seen card is not highlighted', () => {
    const c = n();
    markSeen(c);
    const { container } = render(<CardFrame {...props({ card: c })} />);
    expect(container.querySelector('.card-frame--notify')).toBeNull();
  });

  it('clears on click and records seen', () => {
    const c = n();
    const { container } = render(<CardFrame {...props({ card: c })} />);
    fireEvent.click(container.querySelector('.card-frame')!);
    expect(container.querySelector('.card-frame--notify')).toBeNull();
    expect(JSON.parse(localStorage.getItem(SEEN_KEY)!)).toEqual({ c1: c.updatedAt });
  });

  it('clears on focus', () => {
    const { container } = render(<CardFrame {...props({ card: n() })} />);
    fireEvent.focus(screen.getByRole('button', { name: 'Done' }));
    expect(container.querySelector('.card-frame--notify')).toBeNull();
  });

  it('clears after 1 s at >=50% visibility; leaving resets timer', () => {
    let cb: IntersectionObserverCallback = () => {};
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(c: IntersectionObserverCallback) {
          cb = c;
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    const { container } = render(<CardFrame {...props({ card: n() })} />);
    const fire = (ratio: number) =>
      act(() => {
        cb([{ intersectionRatio: ratio } as IntersectionObserverEntry], {} as IntersectionObserver);
      });
    fire(0.6);
    act(() => {
      vi.advanceTimersByTime(900);
    });
    fire(0.2);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(container.querySelector('.card-frame--notify')).not.toBeNull();
    fire(0.5);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(container.querySelector('.card-frame--notify')).toBeNull();
    expect(localStorage.getItem(SEEN_KEY)).toContain('c1');
  });

  it('new updatedAt re-highlights', () => {
    const c = n();
    markSeen(c);
    const { container, rerender } = render(<CardFrame {...props({ card: c })} />);
    rerender(<CardFrame {...props({ card: { ...c, updatedAt: ago(0) } })} />);
    expect(container.querySelector('.card-frame--notify')).not.toBeNull();
  });
});

describe('motion', () => {
  it('mount-in and updated fade apply, fade ends after 600 ms', () => {
    const c = card();
    const { container, rerender } = render(<CardFrame {...props({ card: c })} />);
    const el = () => container.querySelector('.card-frame')!;
    expect(el().classList.contains('card-frame--enter')).toBe(true);
    expect(el().classList.contains('card-frame--updated')).toBe(false);
    rerender(<CardFrame {...props({ card: { ...c, updatedAt: ago(0) } })} />);
    expect(el().classList.contains('card-frame--updated')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(el().classList.contains('card-frame--updated')).toBe(false);
  });

  it('disabled under prefers-reduced-motion', () => {
    mockMatchMedia(true);
    const c = card();
    const { container, rerender } = render(<CardFrame {...props({ card: c })} />);
    const el = () => container.querySelector('.card-frame')!;
    expect(el().classList.contains('card-frame--enter')).toBe(false);
    rerender(<CardFrame {...props({ card: { ...c, updatedAt: ago(0) } })} />);
    expect(el().classList.contains('card-frame--updated')).toBe(false);
  });
});

describe('collapsed chip', () => {
  const col = () => card({ collapsed: true, priority: 9 });

  it('renders compact chip without body, expand shows body', () => {
    render(<CardFrame {...props({ card: col() })} />);
    expect(screen.queryByTestId('body')).toBeNull();
    expect(screen.getByText('My card')).toBeTruthy();
    expect(screen.getByTestId('priority-marker')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getByTestId('body')).toBeTruthy();
  });

  it('expand survives remount (session) but resets on reload', () => {
    const { unmount } = render(<CardFrame {...props({ card: col() })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    unmount();
    render(<CardFrame {...props({ card: col() })} />);
    expect(screen.getByTestId('body')).toBeTruthy();
    cleanup();
    resetExpanded(); // simulates page reload: in-memory map is gone
    render(<CardFrame {...props({ card: col() })} />);
    expect(screen.queryByTestId('body')).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('non-grid modes ignore collapsed', () => {
    render(<CardFrame {...props({ card: col(), mode: 'fullscreen' })} />);
    expect(screen.getByTestId('body')).toBeTruthy();
  });
});
