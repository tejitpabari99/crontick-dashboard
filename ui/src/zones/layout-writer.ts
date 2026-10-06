import type { LayoutItem } from '../api/types.ts';
import { LAYOUT_DEBOUNCE_MS } from '../constants/timing.ts';

export interface LayoutWriterOptions {
  put(layout: LayoutItem[]): Promise<void>;
  putKeepalive(layout: LayoutItem[]): void;
  delayMs?: number;
}

export interface LayoutWriter {
  /** Queue a full layout; later calls within the window replace it (one PUT per burst). */
  schedule(layout: LayoutItem[]): void;
  /** Send any queued layout now with keepalive (pagehide). */
  flush(): void;
  /** Drop queued layout without sending (unmount / server down). */
  cancel(): void;
  /** True while a write is queued or in flight. */
  busy(): boolean;
}

export function createLayoutWriter(opts: LayoutWriterOptions, onIdle?: () => void): LayoutWriter {
  const delay = opts.delayMs ?? LAYOUT_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queued: LayoutItem[] | null = null;
  let inflight = 0;

  const idleCheck = (): void => {
    if (!queued && inflight === 0) onIdle?.();
  };

  const send = (): void => {
    timer = undefined;
    const layout = queued;
    queued = null;
    if (!layout) return;
    inflight++;
    void opts.put(layout).finally(() => {
      inflight--;
      idleCheck();
    });
  };

  return {
    schedule(layout) {
      queued = layout;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(send, delay);
    },
    flush() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      const layout = queued;
      queued = null;
      if (layout) opts.putKeepalive(layout);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      queued = null;
    },
    busy: () => queued !== null || inflight > 0,
  };
}
