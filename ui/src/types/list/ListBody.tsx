import { useEffect, useMemo, useRef, useState } from 'react';
import { useDelayedSpinner } from '../../lib/delayed-spinner.ts';
import { CardLink } from '../../frame/CardLink.tsx';
import type { CardTypeProps } from '../../registry/registry.ts';
import type { ListData, ListItem } from '../../../../src/index.js';
import { clampProps } from '../shared/clamp.ts';
import { formatDue } from '../shared/format.ts';
import { highlight } from '../shared/highlight.tsx';
import { PageMore, ShowMore } from '../shared/ShowMore.tsx';
import { useQueryFilter } from '../shared/useQueryFilter.ts';
import { dueTimeZone, itemText } from './logic.ts';
import './list.css';

const COMPACT_CAP = 100;
const PAGE = 200;
const ALERT_CAP = 3;
const FAILED_MS = 8000;

interface BoxProps {
  item: ListItem;
  act: 'complete' | 'dismiss';
  checked: boolean;
  pending: boolean;
  onItemAction(itemId: string, checked?: boolean): Promise<void>;
}

/** Checkbox with tri-state feedback: pending (shell set) -> resolved (shell checked set) | failed (inline retry). */
function ItemBox({ item, act, checked, pending, onItemAction }: BoxProps) {
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const spin = useDelayedSpinner(pending);
  useEffect(() => () => clearTimeout(timer.current), []);
  const click = () => {
    if (item.id === undefined || pending || (act === 'dismiss' && checked)) return;
    clearTimeout(timer.current);
    setFailed(false);
    // complete items are untickable; dismiss is one-way (checked dismiss is disabled).
    const next = act === 'complete' ? !checked : true;
    onItemAction(item.id, next).catch(() => {
      setFailed(true);
      timer.current = setTimeout(() => setFailed(false), FAILED_MS);
    });
  };
  return (
    <>
      <input
        type="checkbox"
        className="lst-box"
        aria-label={item.text}
        aria-busy={pending ? 'true' : undefined}
        checked={checked}
        disabled={pending || item.id === undefined || (act === 'dismiss' && checked)}
        onChange={click}
      />
      {spin && <span className="lst-spin" aria-hidden="true" />}
      {failed && (
        <span className="lst-failed" role="status">
          Couldn’t save — retry
        </span>
      )}
    </>
  );
}

function actionType(item: ListItem): 'complete' | 'dismiss' | undefined {
  const a = item.action as { type?: string } | string | undefined;
  const t = typeof a === 'string' ? a : a?.type;
  return t === 'complete' || t === 'dismiss' ? t : undefined;
}

export function ListBody({ card, data, mode, query, checked, pending, onItemAction }: CardTypeProps<ListData>) {
  const alert = mode === 'alert';
  const full = mode === 'fullscreen';
  const items = useMemo<ListItem[]>(() => (Array.isArray(data?.items) ? data.items : []), [data]);
  const [shown, setShown] = useState(PAGE);
  const [hideDone, setHideDone] = useState(false);
  const pre = useQueryFilter(items, query, itemText);
  const isChecked = (it: ListItem) => it.checked === true || (it.id !== undefined && checked.has(it.id));
  const done = items.filter(isChecked).length;
  const now = Date.now();
  const tz = dueTimeZone();

  const pool = full && hideDone ? pre.visible.filter((i) => !isChecked(i)) : pre.visible;
  const cap = alert ? ALERT_CAP : full ? shown : COMPACT_CAP;
  const rows = pool.slice(0, cap);
  const remaining = pool.length - rows.length;

  if (items.length === 0) return <p className="lst-empty">{data?.emptyText || 'Nothing here'}</p>;
  if (pre.zeroMatch)
    return (
      <p className="lst-empty">
        {`No items match “${query}” (${pre.hidden} hidden) — `}
        <button type="button" className="show-more" onClick={pre.showAll}>
          Show all
        </button>
      </p>
    );

  return (
    <div className="lst-root">
      {!alert && (
        <div className="lst-head">
          <span className="lst-count">{`${done} of ${items.length} done`}</span>
          {full && (
            <label className="lst-hide">
              <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
              <span>Hide done</span>
            </label>
          )}
        </div>
      )}
      <ul className={`lst${alert ? ' lst--alert' : ''}`}>
        {rows.map((it, idx) => {
          const c = isChecked(it);
          const act = actionType(it);
          const due = it.due ? formatDue(it.due, now, tz) : null;
          const lines = alert ? 1 : 2;
          const textNode = highlight(it.text, query);
          const mainText = it.link ? (
            <CardLink href={it.link} title={it.text}>
              {textNode}
            </CardLink>
          ) : (
            textNode
          );
          return (
            <li key={it.id ?? idx} className={`lst-item type-motion${c ? ' lst-item--done' : ''}`}>
              {act && (
                <ItemBox
                  item={it}
                  act={act}
                  checked={c}
                  pending={it.id !== undefined && pending.has(it.id)}
                  onItemAction={onItemAction}
                />
              )}
              <div className="lst-main">
                <div className="lst-line">
                  <span {...clampProps(it.text, lines)}>{mainText}</span>
                  {Array.isArray(it.links) &&
                    it.links.map((l, k) => (
                      <span key={k} className="lst-chip">
                        <CardLink href={l.link} title={l.text}>
                          {l.text}
                        </CardLink>
                      </span>
                    ))}
                  {due && (
                    <span className={`lst-due${due.overdue && !c ? ' lst-due--negative' : ''}`}>{due.label}</span>
                  )}
                </div>
                {it.subtitle && !alert && (
                  <div className="lst-sub">
                    <span {...clampProps(it.subtitle, 2)}>{highlight(it.subtitle, query)}</span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {remaining > 0 &&
        (alert ? (
          <span className="lst-more">{`+${remaining}`}</span>
        ) : full ? (
          <PageMore count={Math.min(remaining, PAGE)} onMore={() => setShown((s) => s + PAGE)} />
        ) : (
          <ShowMore cardId={card.id} count={remaining} />
        ))}
    </div>
  );
}
