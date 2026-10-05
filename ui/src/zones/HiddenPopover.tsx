import { useEffect, useRef, useState } from 'react';
import type { ViewCard } from '../api/types.ts';

export interface HiddenPopoverProps {
  cards: readonly ViewCard[];
  onUnhide(id: string): void;
}

export function HiddenPopover(p: HiddenPopoverProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (p.cards.length === 0) return null;
  return (
    <div className="hidden-popover" ref={root}>
      <button type="button" className="header__btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        Hidden ({p.cards.length})
      </button>
      {open ? (
        <div role="dialog" aria-label="Hidden cards" className="hidden-popover__panel">
          <ul>
            {p.cards.map((c) => (
              <li key={c.id}>
                <span className="hidden-popover__title">{c.title}</span>
                <button
                  type="button"
                  aria-label={`Unhide ${c.title}`}
                  onClick={() => {
                    p.onUnhide(c.id);
                    setOpen(false);
                  }}
                >
                  Unhide
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
