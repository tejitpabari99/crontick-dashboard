import type { Snapshot } from './types.ts';

export type SnapshotResult =
  | { status: 'ok'; snapshot: Snapshot; etag: string | null }
  | { status: 'not-modified' };

export interface Client {
  /** Pass the last ETag to get a cheap 304 -> `not-modified`. Throws on network/non-2xx errors. */
  getSnapshot(etag?: string | null): Promise<SnapshotResult>;
}

export interface ClientOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
}

export function createClient(opts: ClientOptions = {}): Client {
  const base = opts.baseUrl ?? '';
  return {
    async getSnapshot(etag) {
      const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
      const headers: Record<string, string> = {};
      if (etag) headers['If-None-Match'] = etag;
      const res = await doFetch(`${base}/api/snapshot`, { headers, cache: 'no-store' });
      if (res.status === 304) return { status: 'not-modified' };
      if (!res.ok) throw new Error(`GET /api/snapshot failed: ${res.status}`);
      return {
        status: 'ok',
        snapshot: (await res.json()) as Snapshot,
        etag: res.headers.get('ETag'),
      };
    },
  };
}
