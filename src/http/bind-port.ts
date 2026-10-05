/**
 * Port selection (mirrors crontick daemon/bind-port): try the preferred port; on EADDRINUSE probe the
 * occupant, emit a notice, and bind an OS-assigned port. Listen/probe are injected for unit tests.
 */
export type PortOccupant = { kind: 'crontick-dashboard'; pid?: number; dataDir?: string } | { kind: 'foreign' };

export interface BindPortDeps {
  /** Bind on loopback; resolves with the actual port, rejects with the listen error (carrying `code`). */
  listen(port: number): Promise<number>;
  /** Identify whatever is listening on `port` (via /api/health). */
  probe(port: number): Promise<PortOccupant>;
  /** Called once with the human-readable fallback notice. */
  notify(message: string): void;
}

export interface BindPortResult {
  port: number;
  preferred: number;
  fellBack: boolean;
  occupant?: PortOccupant;
  message?: string;
}

export function formatPortFallbackMessage(preferred: number, occupant: PortOccupant): string {
  if (occupant.kind === 'crontick-dashboard') {
    const pid = occupant.pid === undefined ? 'unknown' : String(occupant.pid);
    const dir = occupant.dataDir ?? 'unknown';
    return `Port ${preferred} is in use by another crontick-dashboard (pid ${pid}, data dir ${dir}); starting on a free port`;
  }
  return `Port ${preferred} is in use by another process (not crontick-dashboard); starting on a free port`;
}

export async function bindPort(preferred: number, deps: BindPortDeps): Promise<BindPortResult> {
  try {
    const port = await deps.listen(preferred);
    return { port, preferred, fellBack: false };
  } catch (err) {
    if (preferred === 0 || (err as NodeJS.ErrnoException)?.code !== 'EADDRINUSE') throw err;
  }
  let occupant: PortOccupant;
  try {
    occupant = await deps.probe(preferred);
  } catch {
    occupant = { kind: 'foreign' };
  }
  const message = formatPortFallbackMessage(preferred, occupant);
  deps.notify(message);
  const port = await deps.listen(0);
  return { port, preferred, fellBack: true, occupant, message };
}

/** Probe `GET http://127.0.0.1:<port>/api/health` for the crontick-dashboard signature. */
export async function probeHealth(port: number, timeoutMs = 1000): Promise<PortOccupant> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    const j = (await res.json()) as { app?: unknown; pid?: unknown; dataDir?: unknown };
    if (j.app !== 'crontick-dashboard') return { kind: 'foreign' };
    const occ: PortOccupant = { kind: 'crontick-dashboard' };
    if (typeof j.pid === 'number') occ.pid = j.pid;
    if (typeof j.dataDir === 'string') occ.dataDir = j.dataDir;
    return occ;
  } catch {
    return { kind: 'foreign' };
  }
}
