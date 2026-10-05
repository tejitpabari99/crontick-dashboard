import { useEffect, useRef, useState } from 'react';
import type { ViewCard } from '../api/types.ts';
import { formatRelative, useNow } from '../lib/relative-time.ts';
import { isUnseen, markSeen } from '../lib/seen.ts';
import { getCardType, type Mode } from '../registry/registry.ts';
import { UnknownBody } from '../registry/unknown.tsx';
import { BrokenBody } from './BrokenBody.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import './card-frame.css';

export interface CardFrameProps {
  card: ViewCard;
  mode: Mode;
  query: string;
  /** Global search active: this card does not match (dim to 30%, no reflow). */
  dim?: boolean;
  /** Global search active: this card matches (accent outline). */
  match?: boolean;
  checked: ReadonlySet<string>;
  pending: ReadonlySet<string>;
  /** `snapshot.config.nowPriorityThreshold`. */
  nowPriorityThreshold: number;
  onItemAction(itemId: string): Promise<void>;
  onDone(id: string): void;
  onHide(id: string): void;
  onFullscreen(id: string): void;
}

/** Per-session, in-memory expand state for collapsed cards (never persisted; reload resets). */
const expanded = new Set<string>();
const expandedListeners = new Set<() => void>();
let expandedVersion = 0;
export function getExpandedVersion(): number {
  return expandedVersion;
}
function emitExpanded(): void {
  expandedVersion++;
  for (const l of [...expandedListeners]) l();
}
export function resetExpanded(): void {
  expanded.clear();
  emitExpanded();
}
export function isExpanded(id: string): boolean {
  return expanded.has(id);
}
/** Notified whenever any card is expanded/collapsed (grid re-derives collapsed heights). */
export function subscribeExpanded(l: () => void): () => void {
  expandedListeners.add(l);
  return () => {
    expandedListeners.delete(l);
  };
}

const FADE_MS = 600;
const SEEN_DWELL_MS = 1000;

function reducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function CardFrame(p: CardFrameProps) {
  const { card, mode } = p;
  const rootRef = useRef<HTMLElement>(null);
  const now = useNow();
  const [, bump] = useState(0);
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [reduced] = useState(reducedMotion);
  const prevUpdated = useRef(card.updatedAt);

  const highlighted = card.notify && seenAt !== card.updatedAt && isUnseen(card);

  const see = () => {
    if (!highlighted) return;
    markSeen(card);
    setSeenAt(card.updatedAt);
  };

  // 600 ms accent fade when updatedAt changes after first render.
  useEffect(() => {
    if (prevUpdated.current === card.updatedAt) return;
    prevUpdated.current = card.updatedAt;
    if (reduced) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), FADE_MS);
    return () => clearTimeout(t);
  }, [card.updatedAt, reduced]);

  // Clear highlight after 1 s of >=50% visibility.
  useEffect(() => {
    const el = rootRef.current;
    if (!highlighted || !el || typeof IntersectionObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[entries.length - 1];
        if (e && e.intersectionRatio >= 0.5) {
          timer ??= setTimeout(() => {
            markSeen({ id: card.id, updatedAt: card.updatedAt });
            setSeenAt(card.updatedAt);
          }, SEEN_DWELL_MS);
        } else if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
      },
      { threshold: [0.5] },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [highlighted, card.id, card.updatedAt]);

  const broken = card.status === 'broken';
  const isChip = mode === 'grid' && card.collapsed && !expanded.has(card.id);
  const isPriority = card.priority >= p.nowPriorityThreshold;

  const toggle = () => {
    if (expanded.has(card.id)) expanded.delete(card.id);
    else expanded.add(card.id);
    bump((n) => n + 1);
    emitExpanded();
  };

  const cls = [
    'card-frame',
    broken && 'card-frame--broken',
    isChip && 'card-frame--chip',
    highlighted && 'card-frame--notify',
    !reduced && 'card-frame--enter',
    flash && 'card-frame--updated',
    p.dim && 'card-frame--dim',
    p.match && 'card-frame--match',
  ]
    .filter(Boolean)
    .join(' ');

  const marker = isPriority ? (
    <span className="card-frame__priority" data-testid="priority-marker" title={`Priority ${card.priority}`} aria-label="High priority" />
  ) : null;
  const dot = highlighted ? <span className="card-frame__dot" data-testid="notify-dot" aria-label="New" /> : null;

  if (isChip) {
    return (
      <section ref={rootRef} className={cls} data-card-id={card.id} aria-label={card.title} onClick={see} onFocus={see}>
        <header className="card-frame__bar drag-handle">
          {dot}
          {marker}
          <h3 className="card-frame__title" title={card.title}>
            {card.title}
          </h3>
          <button type="button" className="card-frame__btn" aria-label="Expand" aria-expanded="false" onClick={toggle}>
            ▾
          </button>
        </header>
      </section>
    );
  }

  const def = broken ? undefined : getCardType(card.type);
  const Body = def?.Component;

  return (
    <section ref={rootRef} className={cls} data-card-id={card.id} aria-label={card.title} onClick={see} onFocus={see}>
      <header className="card-frame__bar drag-handle">
        {dot}
        {marker}
        <h3 className="card-frame__title" title={card.title}>
          {card.title}
        </h3>
        <span className="card-frame__meta" title={new Date(card.updatedAt).toLocaleString()}>
          {formatRelative(card.updatedAt, now)}
        </span>
        <span className="card-frame__actions">
          {card.collapsed && mode === 'grid' ? (
            <button type="button" className="card-frame__btn" aria-label="Collapse" aria-expanded="true" onClick={toggle}>
              ▴
            </button>
          ) : null}
          <button type="button" className="card-frame__btn" aria-label="Fullscreen" onClick={() => p.onFullscreen(card.id)}>
            ⤢
          </button>
          <button type="button" className="card-frame__btn" aria-label="Done" onClick={() => p.onDone(card.id)}>
            ✓
          </button>
          <button type="button" className="card-frame__btn" aria-label="Hide" onClick={() => p.onHide(card.id)}>
            ✕
          </button>
        </span>
      </header>
      {broken ? (
        <BrokenBody card={card} />
      ) : (
        <div className="card-frame__body">
          <ErrorBoundary>
            {Body ? (
              <Body
                card={card}
                data={card.data}
                mode={mode}
                query={p.query}
                checked={p.checked}
                pending={p.pending}
                onItemAction={p.onItemAction}
              />
            ) : (
              <UnknownBody type={card.type} />
            )}
          </ErrorBoundary>
        </div>
      )}
    </section>
  );
}
