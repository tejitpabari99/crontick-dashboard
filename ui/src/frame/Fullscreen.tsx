import { useEffect, useRef } from 'react';
import type { ViewCard } from '../api/types.ts';
import { CardFrame } from './CardFrame.tsx';
import './fullscreen.css';

export interface FullscreenProps {
  card: ViewCard;
  /** Global search string, inherited. */
  query: string;
  checked: ReadonlySet<string>;
  pending: ReadonlySet<string>;
  nowPriorityThreshold: number;
  onItemAction(itemId: string): Promise<void>;
  onDone(id: string): void;
  onHide(id: string): void;
  onClose(): void;
}

/** Native modal `<dialog>`: focus trap + Esc come from showModal; focus returns to the opener on unmount. */
export function Fullscreen(p: FullscreenProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(p.onClose);
  closeRef.current = p.onClose;
  const unmounting = useRef(false);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const d = ref.current;
    if (d) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
    return () => {
      unmounting.current = true;
      if (d?.open && typeof d.close === 'function') d.close();
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="fullscreen"
      aria-label={`${p.card.title} (fullscreen)`}
      onCancel={(e) => {
        e.preventDefault();
        closeRef.current();
      }}
      onClose={() => {
        if (!unmounting.current) closeRef.current();
      }}
    >
      <button type="button" className="fullscreen__close card-frame__btn" aria-label="Close fullscreen" onClick={p.onClose}>
        ✕
      </button>
      <CardFrame
        card={p.card}
        mode="fullscreen"
        query={p.query}
        checked={p.checked}
        pending={p.pending}
        nowPriorityThreshold={p.nowPriorityThreshold}
        onItemAction={p.onItemAction}
        onDone={(id) => {
          p.onDone(id);
          p.onClose();
        }}
        onHide={(id) => {
          p.onHide(id);
          p.onClose();
        }}
        onFullscreen={() => undefined}
      />
    </dialog>
  );
}
