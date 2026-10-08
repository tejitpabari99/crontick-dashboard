import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { formatDue, formatNumber } from '../../src/types/shared/format.ts';
import { highlight } from '../../src/types/shared/highlight.tsx';
import { matchTokens } from '../../src/types/shared/matchTokens.ts';
import { safeImageSrc } from '../../src/types/shared/safeImageSrc.ts';
import { clampProps } from '../../src/types/shared/clamp.ts';
import { PageMore, ShowMore } from '../../src/types/shared/ShowMore.tsx';
import { useQueryFilter } from '../../src/types/shared/useQueryFilter.ts';

describe('matchTokens', () => {
  it('empty query matches', () => {
    expect(matchTokens('abc', '')).toBe(true);
    expect(matchTokens('abc', '   ')).toBe(true);
  });
  it('case-insensitive substring, AND over tokens', () => {
    expect(matchTokens('Dana Lee on-call', 'DANA call')).toBe(true);
    expect(matchTokens('Dana Lee', 'dana  zed')).toBe(false);
  });
});

describe('highlight', () => {
  it('wraps matches in <mark> React nodes, never HTML', () => {
    const { container } = render(<p>{highlight('Hello <b>World</b> hello', 'hello')}</p>);
    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(2);
    expect(marks[0]?.textContent).toBe('Hello');
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toBe('Hello <b>World</b> hello');
  });
  it('multiple tokens, empty query returns plain text', () => {
    const { container } = render(<p>{highlight('alpha beta gamma', 'alp gam')}</p>);
    expect([...container.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['alp', 'gam']);
    expect(highlight('x', '')).toEqual(['x']);
  });
  it('regex chars in query are literal', () => {
    const { container } = render(<p>{highlight('a.b axb', 'a.b')}</p>);
    expect(container.querySelectorAll('mark')).toHaveLength(1);
  });
});

describe('useQueryFilter', () => {
  const items = ['apple', 'banana', 'avocado'];
  it('filters by query, reports hidden', () => {
    const { result } = renderHook(({ q }) => useQueryFilter(items, q, (s) => s), { initialProps: { q: 'ap' } });
    expect(result.current.visible).toEqual(['apple']);
    expect(result.current.hidden).toBe(2);
    expect(result.current.zeroMatch).toBe(false);
  });
  it('empty query shows all', () => {
    const { result } = renderHook(() => useQueryFilter(items, '', (s) => s));
    expect(result.current.visible).toEqual(items);
    expect(result.current.hidden).toBe(0);
  });
  it('zero match + showAll override, reset on query change', () => {
    const { result, rerender } = renderHook(({ q }) => useQueryFilter(items, q, (s) => s), {
      initialProps: { q: 'zzz' },
    });
    expect(result.current.visible).toEqual([]);
    expect(result.current.zeroMatch).toBe(true);
    act(() => result.current.showAll());
    expect(result.current.visible).toEqual(items);
    expect(result.current.zeroMatch).toBe(false);
    rerender({ q: 'zzz' });
    expect(result.current.visible).toEqual(items);
    rerender({ q: 'yyy' });
    expect(result.current.visible).toEqual([]);
    expect(result.current.zeroMatch).toBe(true);
  });
});

describe('safeImageSrc', () => {
  it('allows http(s) and data:image/*', () => {
    expect(safeImageSrc('https://x.test/a.png')).toBe('https://x.test/a.png');
    expect(safeImageSrc(' http://x.test/a.png ')).toBe('http://x.test/a.png');
    expect(safeImageSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });
  it('denies everything else', () => {
    for (const s of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'data:application/json,{}',
      'ftp://x/y.png',
      '/rel/a.png',
      'ms-outlook://x',
      '',
      'not a url',
    ])
      expect(safeImageSrc(s)).toBeNull();
    expect(safeImageSrc(undefined)).toBeNull();
    expect(safeImageSrc(5 as unknown as string)).toBeNull();
  });
});

describe('format', () => {
  it('formatNumber uses locale grouping', () => {
    expect(formatNumber(1234.5, 'en-US')).toBe('1,234.5');
    expect(formatNumber(NaN)).toBe('–');
  });
  const NOW = Date.parse('2026-10-05T15:00:00Z'); // Mon 5 Oct 2026 UTC
  it('date-only: today/tomorrow/weekday/overdue', () => {
    expect(formatDue('2026-10-05', NOW, 'UTC')).toEqual({ label: 'Today', overdue: false });
    expect(formatDue('2026-10-06', NOW, 'UTC')).toEqual({ label: 'Tomorrow', overdue: false });
    expect(formatDue('2026-10-12', NOW, 'UTC')).toEqual({ label: 'Mon 12', overdue: false });
    expect(formatDue('2026-10-04', NOW, 'UTC')).toEqual({ label: 'Overdue 1d', overdue: true });
    expect(formatDue('2026-10-02', NOW, 'UTC')).toEqual({ label: 'Overdue 3d', overdue: true });
  });
  it('timezone shifts the calendar day', () => {
    // 15:00Z is already Tue 6 Oct 04:00 in Pacific/Auckland, still 5 Oct in UTC
    expect(formatDue('2026-10-06', NOW, 'Pacific/Auckland').label).toBe('Today');
    expect(formatDue('2026-10-06', NOW, 'UTC').label).toBe('Tomorrow');
    expect(formatDue('2026-10-05', NOW, 'Pacific/Auckland')).toEqual({ label: 'Overdue 1d', overdue: true });
  });
  it('datetime: time when today, overdue when before now', () => {
    expect(formatDue('2026-10-05T18:30:00Z', NOW, 'UTC')).toEqual({ label: 'Today 18:30', overdue: false });
    expect(formatDue('2026-10-05T09:00:00Z', NOW, 'UTC')).toEqual({ label: 'Overdue 09:00', overdue: true });
    expect(formatDue('2026-10-04T09:00:00Z', NOW, 'UTC')).toEqual({ label: 'Overdue 1d', overdue: true });
    expect(formatDue('2026-10-06T09:00:00Z', NOW, 'UTC')).toEqual({ label: 'Tomorrow', overdue: false });
    expect(formatDue('2026-10-05T18:30:00Z', NOW, 'Asia/Kolkata').label).toBe('Tomorrow');
  });
  it('invalid due is total', () => {
    expect(formatDue('garbage', NOW, 'UTC')).toEqual({ label: 'garbage', overdue: false });
  });
});

describe('clampProps', () => {
  it('gives class and title tooltip', () => {
    expect(clampProps('long text', 2)).toEqual({ className: 'clamp-2', title: 'long text' });
    expect(clampProps('t', 1)).toEqual({ className: 'clamp-1', title: 't' });
  });
});

describe('ShowMore', () => {
  afterEach(() => history.replaceState(null, '', '/'));
  it('is a button that opens fullscreen via hash', () => {
    render(<ShowMore cardId="my card" count={7} />);
    const b = screen.getByRole('button', { name: '+7 more' });
    expect(b.tagName).toBe('BUTTON');
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(b);
    expect(location.hash).toBe('#card=my%20card&view=full');
  });
  it('PageMore calls onMore', () => {
    let n = 0;
    render(<PageMore count={200} onMore={() => n++} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show 200 more' }));
    expect(n).toBe(1);
  });
});
