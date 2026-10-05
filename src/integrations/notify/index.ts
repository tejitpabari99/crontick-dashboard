export type { NotifyAdapter, NotifyPayload } from './adapter.js';
export { FakeNotifyAdapter } from './fake.js';
export { createNodeNotifierAdapter, AUMID } from './node-notifier-adapter.js';
export { resolveNotifyMode, detectNotifySend } from './gate.js';
export type { NotifyGateInput, NotifyGateResult, NotifyOsSetting } from './gate.js';
export { createNotifier, realTimers, BURST_WINDOW_MS, BURST_LIMIT, summarize, stripMarkdown } from './notifier.js';
export type { Notifier, NotifierOptions, NotifierStatus, GateValue, Timers } from './notifier.js';
