import { useEffect, useRef } from 'react';
import type { ViewCard } from '../api/types.ts';

export interface OtherMatch {
  card: ViewCard;
  where: 'tray' | 'hidden';
}

export interface SearchBoxProps {
  query: string;
  onQuery(q: string): void;
  /** Matching cards that are on screen (alerts, Now, grid), in reading order. */
  visibleIds: readonly string[];
  /** Total matches including tray and hidden. */
  total: number;
  /** Tray / hidden matches (not on screen). */
  others: readonly OtherMatch[];
  onReopen(id: string): void;
  onUnhide(id: string): void;
}

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return true;
  const ce = t.closest('[contenteditable]');
  return ce !== null && ce.getAttribute('contenteditable') !== 'false';
}

function focusCard(id: string): void {
  const el = document.querySelector<HTMLElement>(`[data-card-id="${id.replace(/"/g, '\\"')}"]`);
  if (!el) return;
  if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
  el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  el.focus();
}

export function SearchBox(p: SearchBoxProps) {
  const ref = useRef<HTMLInputElement>(null);
  const cursor = useRef(-1);

  useEffect(() => {
    cursor.current = -1;
  }, [p.query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.altKey) return;
      const key = e.key.toLowerCase();
      const focus = (): void => {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      };
      if ((e.ctrlKey || e.metaKey) && key === 'k') return focus();
      if (e.ctrlKey || e.metaKey) return;
      if ((key === '/' || key === 's') && !isEditable(e.target)) focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (p.query) p.onQuery('');
      else ref.current?.blur();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const n = p.visibleIds.length;
      if (n === 0) return;
      const next = e.shiftKey ? (cursor.current <= 0 ? n - 1 : cursor.current - 1) : (cursor.current + 1) % n;
      cursor.current = next;
      const id = p.visibleIds[next];
      if (id) focusCard(id);
    }
  };

  return (
    <div className="search-box">
      <input
        ref={ref}
        type="search"
        role="searchbox"
        aria-label="Search cards"
        placeholder="Search ( / )"
        value={p.query}
        onChange={(e) => p.onQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {p.query.trim() ? (
        <span className="search-box__count" aria-live="polite">
          {p.total} {p.total === 1 ? 'match' : 'matches'}
        </span>
      ) : null}
      {p.query.trim() && p.others.length > 0 ? (
        <ul className="search-box__dropdown" aria-label="Other matches">
          {p.others.map(({ card, where }) => (
            <li key={card.id}>
              <span className="search-box__title">{card.title}</span>
              <span className="search-box__badge">{where === 'tray' ? 'Done' : 'Hidden'}</span>
              {where === 'tray' ? (
                <button type="button" aria-label={`Open ${card.title}`} onClick={() => p.onReopen(card.id)}>
                  Open
                </button>
              ) : (
                <button type="button" aria-label={`Unhide ${card.title}`} onClick={() => p.onUnhide(card.id)}>
                  Unhide
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
