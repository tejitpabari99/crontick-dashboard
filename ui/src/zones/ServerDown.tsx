import './server-down.css';

export interface ServerDownProps {
  retryMs: number;
}

/** Full-page state shown instead of the dashboard while the server is unreachable (U9). */
export function ServerDown(p: ServerDownProps) {
  const secs = Math.round(p.retryMs / 1000);
  return (
    <section className="server-down" aria-labelledby="server-down-h" data-testid="server-down">
      <span className="server-down__icon" aria-hidden="true">
        ⚠
      </span>
      <h2 id="server-down-h" className="server-down__title">
        Server down
      </h2>
      <p className="server-down__retry" role="status">{`Retrying every ${secs} s…`}</p>
      <p className="server-down__hint">
        Start it with <code>crontick-dashboard daemon start</code>
      </p>
    </section>
  );
}
