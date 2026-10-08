import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { getMutations, useMutationView, type Mutations } from './api/mutations.ts';
import { getToastStore, type ToastStore } from './api/toasts.ts';
import type { Column, ViewAlert, ViewCard } from './api/types.ts';
import { Fullscreen } from './frame/Fullscreen.tsx';
import { buildCardHash, parseCardHash, replaceHash, useHash } from './lib/hash.ts';
import { attentionCount } from './lib/attention.ts';
import { getSeenVersion, subscribeSeen } from './lib/seen.ts';
import { matchCards, toSearchCard } from './lib/search.ts';
import { AlertStrip } from './zones/AlertStrip.tsx';
import { Columns } from './zones/Columns.tsx';
import { Header } from './zones/Header.tsx';
import { ServerDown } from './zones/ServerDown.tsx';
import { ToastHost } from './zones/ToastHost.tsx';

const HIGHLIGHT_MS = 2000;

export interface AppProps {
  mutations?: Mutations;
  toasts?: ToastStore;
}

export function App(props: AppProps = {}) {
  const m = props.mutations ?? getMutations();
  const toasts = props.toasts ?? getToastStore();
  const { state } = useMutationView(m);
  const [query, setQuery] = useState('');
  const snap = state.snapshot;
  const down = state.serverDown;
  const pick = (ids: readonly string[] | undefined): ViewCard[] =>
    (ids ?? []).map((id) => snap?.cards[id]).filter((c): c is ViewCard => Boolean(c));
  const alerts = useMemo(
    () => (snap?.alerts ?? []).map((id) => snap?.alertItems[id]).filter((a): a is ViewAlert => Boolean(a)),
    [snap],
  );
  const now = useMemo(() => pick(snap?.now), [snap]);
  const columns = useMemo<Record<Column, ViewCard[]>>(
    () => ({ left: pick(snap?.columns.left), center: pick(snap?.columns.center), right: pick(snap?.columns.right) }),
    [snap],
  );
  const hidden = useMemo(() => pick(snap?.hidden), [snap]);
  const threshold = snap?.config.nowPriorityThreshold ?? 5;
  const onItemAction = (cardId: string, itemId: string, checked?: boolean): Promise<void> =>
    m.onItemAction(cardId, itemId, checked);

  const searching = query.trim() !== '';
  const visible = useMemo(
    () => [...now, ...columns.center, ...columns.left, ...columns.right],
    [now, columns],
  );
  const visibleIds = useMemo(() => matchCards(visible.map(toSearchCard), query), [visible, query]);
  const matchIds = useMemo(() => (searching ? new Set(visibleIds) : null), [searching, visibleIds]);
  // Done-card search matches arrive with the Completed section (T7/T8).
  const others = useMemo(() => {
    const h = new Set(matchCards(hidden.map(toSearchCard), query));
    return hidden.filter((c) => h.has(c.id)).map((card) => ({ card, where: 'hidden' as const }));
  }, [hidden, query]);

  const hash = useHash();
  const target = useMemo(() => parseCardHash(hash), [hash]);
  const openFullscreen = (id: string): void => replaceHash(buildCardHash(id, true));
  const closeFullscreen = (): void => replaceHash('');
  const fsCard = target?.full && snap ? snap.cards[target.id] : undefined;

  // Deep links (`#card=<id>` scroll+highlight, `&view=full` fullscreen). Waits for the first snapshot.
  useEffect(() => {
    if (!target || !snap) return;
    const c = snap.cards[target.id];
    if (!c) {
      toasts.push('card not found');
      replaceHash('');
      return;
    }
    if (target.full) return;
    replaceHash('');
    if (c.done) {
      toasts.push(`${c.title} is Done`);
      return;
    }
    if (snap.hidden.includes(c.id)) {
      toasts.push(`${c.title} is hidden`);
      return;
    }
    const el = document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(c.id)}"]`);
    if (!el) return;
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('card-highlight');
    window.setTimeout(() => el.classList.remove('card-highlight'), HIGHLIGHT_MS);
  }, [target, snap, toasts]);

  useSyncExternalStore(subscribeSeen, getSeenVersion);
  const count = snap ? attentionCount(snap) : 0;
  useEffect(() => {
    document.title = down ? 'Server down' : count > 0 ? `(${count}) Crontick` : 'Crontick';
  }, [count, down]);
  const empty =
    snap !== null &&
    [snap.columns.left, snap.columns.center, snap.columns.right, snap.now, snap.alerts, snap.hidden, snap.completed].every(
      (z) => z.length === 0,
    );

  return (
    <>
      <Header
        alertCount={alerts.length}
        hidden={hidden}
        connectionOk={state.consecutiveFailures === 0}
        minimal={down}
        onUnhide={(id) => void m.unhide(id)}
        search={{
          query,
          onQuery: setQuery,
          visibleIds,
          total: visibleIds.length + others.length,
          others,
          onReopen: (id) => void m.reopen(id),
          onUnhide: (id) => void m.unhide(id),
        }}
      />
      <main className="page">
        {down ? (
          <ServerDown retryMs={state.retryMs} />
        ) : empty ? (
          <section className="empty-state" aria-labelledby="empty-state-h" data-testid="empty-state">
            <h2 id="empty-state-h">No cards yet</h2>
            <p>
              Cards come from your feed folder. Run <code>crontick-dashboard info</code> to see the feed path.
            </p>
          </section>
        ) : snap ? (
          <>
            <AlertStrip alerts={alerts} nowPriorityThreshold={threshold} onTick={(id) => void m.tick(id)} />
            <Columns
              columns={columns}
              now={now}
              query={query}
              matchIds={matchIds}
              nowPriorityThreshold={threshold}
              checked={m.getChecked}
              pending={m.getPending}
              onItemAction={onItemAction}
              onDone={(id) => void m.done(id)}
              onHide={(id) => void m.hide(id)}
              onFullscreen={openFullscreen}
            />
            {/* Completed section (done cards + ticked alerts) is built in a later task (T7). */}
          </>
        ) : null}
      </main>
      {fsCard && !down ? (
        <Fullscreen
          key={fsCard.id}
          card={fsCard}
          query={query}
          checked={m.getChecked(fsCard.id)}
          pending={m.getPending(fsCard.id)}
          nowPriorityThreshold={threshold}
          onItemAction={(itemId, checked) => onItemAction(fsCard.id, itemId, checked)}
          onDone={(id) => void m.done(id)}
          onHide={(id) => void m.hide(id)}
          onClose={closeFullscreen}
        />
      ) : null}
      {down ? null : <ToastHost store={toasts} />}
    </>
  );
}
