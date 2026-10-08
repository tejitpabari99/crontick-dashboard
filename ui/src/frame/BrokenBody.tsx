import type { ViewCard } from '../api/types.ts';

/** Broken card body: reason + message only. Never reads or renders `card.data`. */
export function BrokenBody({ card }: { card: Pick<ViewCard, 'reason' | 'message'> }) {
  return (
    <div className="card-broken" role="group" aria-label="Broken card">
      <span className="card-broken__icon" aria-hidden="true">
        ⚠
      </span>
      <div className="card-broken__text">
        {card.reason ? <div className="card-broken__reason">{card.reason}</div> : null}
        <p className="card-broken__message">{card.message ?? 'This card could not be rendered.'}</p>
      </div>
    </div>
  );
}
