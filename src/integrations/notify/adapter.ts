export interface NotifyPayload {
  title: string;
  body: string;
  /** Server-built deep link, e.g. http://127.0.0.1:<port>/#card=<id>. */
  openUrl: string;
}

export interface NotifyAdapter {
  /** Resolves once delivery is handed off; rejects on delivery failure. Never waits for a click. */
  notify(payload: NotifyPayload): Promise<void>;
}
