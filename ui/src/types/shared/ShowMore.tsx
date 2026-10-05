import { buildCardHash, replaceHash } from '../../lib/hash.ts';
import './shared.css';

/** Compact "+N more": a button (not a link) that opens the card's fullscreen. */
export function ShowMore({ cardId, count }: { cardId: string; count: number }) {
  return (
    <button type="button" className="show-more" onClick={() => replaceHash(buildCardHash(cardId, true))}>
      {`+${count} more`}
    </button>
  );
}

/** Fullscreen paging variant: "Show N more" reveals the next page locally. */
export function PageMore({ count, onMore }: { count: number; onMore: () => void }) {
  return (
    <button type="button" className="show-more" onClick={onMore}>
      {`Show ${count} more`}
    </button>
  );
}
