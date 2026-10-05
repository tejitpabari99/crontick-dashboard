import type { NotifyAdapter, NotifyPayload } from './adapter.js';

export type FakeFailure = { mode: 'throw' | 'reject'; error: Error };

/** Test double: records calls; can be told to throw synchronously or reject. */
export class FakeNotifyAdapter implements NotifyAdapter {
  readonly calls: NotifyPayload[] = [];
  failWith: FakeFailure | undefined;

  notify(payload: NotifyPayload): Promise<void> {
    this.calls.push(payload);
    if (this.failWith?.mode === 'throw') throw this.failWith.error;
    if (this.failWith?.mode === 'reject') return Promise.reject(this.failWith.error);
    return Promise.resolve();
  }
}
