import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDelayedSpinner } from '../src/lib/delayed-spinner.ts';
import { SPINNER_DELAY_MS } from '../src/constants/timing.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('shows only after SPINNER_DELAY_MS of continuous activity', () => {
  const { result, rerender } = renderHook(({ on }) => useDelayedSpinner(on), {
    initialProps: { on: true },
  });
  expect(result.current).toBe(false);
  act(() => void vi.advanceTimersByTime(SPINNER_DELAY_MS - 1));
  expect(result.current).toBe(false);
  act(() => void vi.advanceTimersByTime(1));
  expect(result.current).toBe(true);
  rerender({ on: false });
  expect(result.current).toBe(false);
});

it('never shows if activity ends before SPINNER_DELAY_MS', () => {
  const { result, rerender } = renderHook(({ on }) => useDelayedSpinner(on), {
    initialProps: { on: true },
  });
  act(() => void vi.advanceTimersByTime(SPINNER_DELAY_MS - 50));
  rerender({ on: false });
  act(() => void vi.advanceTimersByTime(500));
  expect(result.current).toBe(false);
});
