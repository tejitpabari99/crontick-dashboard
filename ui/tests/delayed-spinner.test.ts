import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDelayedSpinner } from '../src/lib/delayed-spinner.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('shows only after 150 ms of continuous activity', () => {
  const { result, rerender } = renderHook(({ on }) => useDelayedSpinner(on), {
    initialProps: { on: true },
  });
  expect(result.current).toBe(false);
  act(() => void vi.advanceTimersByTime(149));
  expect(result.current).toBe(false);
  act(() => void vi.advanceTimersByTime(1));
  expect(result.current).toBe(true);
  rerender({ on: false });
  expect(result.current).toBe(false);
});

it('never shows if activity ends before 150 ms', () => {
  const { result, rerender } = renderHook(({ on }) => useDelayedSpinner(on), {
    initialProps: { on: true },
  });
  act(() => void vi.advanceTimersByTime(100));
  rerender({ on: false });
  act(() => void vi.advanceTimersByTime(500));
  expect(result.current).toBe(false);
});
