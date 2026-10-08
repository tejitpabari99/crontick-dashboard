import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewCard } from '../src/api/types.ts';
import { Chip } from '../src/frame/Chip.tsx';
import { markSeen } from '../src/lib/seen.ts';

function card(over: Partial<ViewCard> = {}): ViewCard {
  return {
    id: 'c1',
    type: 'markdown',
    title: 'Quiet card',
    priority: 1,
    notify: false,
    updatedAt: '2026-10-05T10:00:00Z',
    column: 'left',
    height: 'S',
    status: 'ok',
    collapsed: true,
    done: false,
    data: {},
    ...over,
  };
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('Chip', () => {
  it('is a collapsed button with label and aria-expanded=false', () => {
    render(<Chip card={card()} onExpand={() => {}} />);
    const b = screen.getByRole('button', { name: 'Expand Quiet card' });
    expect(b.tagName).toBe('BUTTON');
    expect(b.getAttribute('aria-expanded')).toBe('false');
    expect(b.classList.contains('chip--collapsed')).toBe(true);
    expect(b.textContent).toContain('Quiet card');
    expect(b.textContent).toContain('▾');
  });

  it('click expands with card id', () => {
    const onExpand = vi.fn();
    render(<Chip card={card()} onExpand={onExpand} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onExpand).toHaveBeenCalledWith('c1');
  });

  it('is natively keyboard-activatable (button, not tabindex-less div)', () => {
    render(<Chip card={card()} onExpand={() => {}} />);
    const b = screen.getByRole('button') as HTMLButtonElement;
    expect(b.type).toBe('button');
    expect(b.disabled).toBe(false);
    expect(b.tabIndex).toBe(0);
  });

  it('shows notify dot only for unseen notify cards', () => {
    const { rerender } = render(<Chip card={card({ notify: true })} onExpand={() => {}} />);
    expect(screen.getByTestId('notify-dot')).toBeTruthy();
    rerender(<Chip card={card()} onExpand={() => {}} />);
    expect(screen.queryByTestId('notify-dot')).toBeNull();
    const c = card({ notify: true });
    markSeen({ id: c.id, updatedAt: c.updatedAt! });
    rerender(<Chip card={c} onExpand={() => {}} />);
    expect(screen.queryByTestId('notify-dot')).toBeNull();
  });

  it('no-updatedAt notify card shows no dot', () => {
    render(<Chip card={card({ notify: true, updatedAt: undefined, status: 'no-data' })} onExpand={() => {}} />);
    expect(screen.queryByTestId('notify-dot')).toBeNull();
  });
});
