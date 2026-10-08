import { useEffect, useRef } from 'react';
import { targetSelector, type SearchTarget } from '../lib/search.ts';

export interface OtherMatch {
  id: string;
  title: string;
  where: 'hidden' | 'completed';
  /** Completed matches only. */
  completedKind?: 'card' | 'alert';
}

export interface SearchBoxProps {
  query: string;
  onQuery(q: string): void;
  /** Matches on screen (alerts, Now, center, left, right, open Completed), in DOM order. */
  visible: readonly SearchTarget[];
  /** Total matches including hidden and collapsed-Completed. */
  total: number;
  /** Hidden / collapsed-Completed matches (not on screen). */
  others: readonly OtherMatch[];
  onUnhide(id: string): void;
  /** Open the Completed section, scroll to and highlight the row. */
  onOpenCompleted(m: OtherMatch): void;
}

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return true;
  const ce = t.closest('[contenteditable]');
  return ce !== null && ce.getAttribute('contenteditable') !== 'false';
}

function focusTarget(t: SearchTarget): void {
  const el = document.querySelector<HTMLElement>(targetSelector(t));
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
      const n = p.visible.length;
      if (n === 0) return;
      const next = e.shiftKey ? (cursor.current <= 0 ? n - 1 : cursor.current - 1) : (cursor.current + 1) % n;
      cursor.current = next;
      const t = p.visible[next];
      if (t) focusTarget(t);
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
          {p.others.map((o) => (
            <li key={`${o.where}:${o.completedKind ?? ''}:${o.id}`}>
              <span className="search-box__title">{o.title}</span>
              <span className="search-box__badge">{o.where === 'completed' ? 'Completed' : 'Hidden'}</span>
              {o.where === 'completed' ? (
                <button type="button" aria-label={`Show ${o.title}`} onClick={() => p.onOpenCompleted(o)}>
                  Show
                </button>
              ) : (
                <button type="button" aria-label={`Unhide ${o.title}`} onClick={() => p.onUnhide(o.id)}>
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
