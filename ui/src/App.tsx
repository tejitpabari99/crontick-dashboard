import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { getMutations, useMutationView, type Mutations } from './api/mutations.ts';
import { getToastStore, type ToastStore } from './api/toasts.ts';
import type { Column, ViewAlert, ViewCard } from './api/types.ts';
import { Fullscreen } from './frame/Fullscreen.tsx';
import { buildCardHash, parseCardHash, replaceHash, useHash } from './lib/hash.ts';
import { useFilter } from './lib/filter.ts';
import { useCompletedOpen } from './lib/completed-open.ts';
import { attentionCount } from './lib/attention.ts';
import { getSeenVersion, subscribeSeen } from './lib/seen.ts';
import { matchCards, toSearchAlert, toSearchCard, type SearchCard, type SearchTarget } from './lib/search.ts';
import type { OtherMatch } from './zones/SearchBox.tsx';
import { AlertStrip } from './zones/AlertStrip.tsx';
import { Columns } from './zones/Columns.tsx';
import { Completed, resolveCompleted, type CompletedRow } from './zones/Completed.tsx';
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
  const [filter, setFilter] = useFilter();
  const [completedOpen, setCompletedOpen] = useCompletedOpen();
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
  const completedRows = useMemo(() => (snap ? resolveCompleted(snap, filter) : []), [snap, filter]);
  const hidden = useMemo(() => pick(snap?.hidden), [snap]);
  const threshold = snap?.config.nowPriorityThreshold ?? 5;
  const onItemAction = (cardId: string, itemId: string, checked?: boolean): Promise<void> =>
    m.onItemAction(cardId, itemId, checked);

  const searching = query.trim() !== '';
  const showAlerts = filter !== 'cards';
  const showCards = filter !== 'alerts';
  const alertHits = useMemo(
    () => (showAlerts ? matchCards(alerts.map(toSearchAlert), query) : []),
    [showAlerts, alerts, query],
  );
  // Visible cards in DOM order: Now, then center, left, right.
  const cardHits = useMemo(
    () => (showCards ? matchCards([...now, ...columns.center, ...columns.left, ...columns.right].map(toSearchCard), query) : []),
    [showCards, now, columns, query],
  );
  const completedKey = (r: CompletedRow): string => `${r.kind}:${r.id}`;
  const completedHits = useMemo(() => {
    const cards: SearchCard[] = completedRows.map((r) => ({
      id: completedKey(r),
      title: r.kind === 'card' ? r.title : r.item.title,
      status: 'ok',
      searchText: r.kind === 'alert' ? r.item.text : undefined,
    }));
    return matchCards(cards, query);
  }, [completedRows, query]);
  const matchIds = useMemo(() => (searching ? new Set(cardHits) : null), [searching, cardHits]);
  const alertMatchIds = useMemo(() => (searching ? new Set(alertHits) : null), [searching, alertHits]);
  const completedMatchKeys = useMemo(() => (searching ? new Set(completedHits) : null), [searching, completedHits]);
  const visible = useMemo<SearchTarget[]>(() => {
    const out: SearchTarget[] = [
      ...alertHits.map((id): SearchTarget => ({ zone: 'alert', id })),
      ...cardHits.map((id): SearchTarget => ({ zone: 'card', id })),
    ];
    if (completedOpen) {
      for (const r of completedRows) {
        if (completedMatchKeys?.has(completedKey(r))) out.push({ zone: 'completed', id: r.id, completedKind: r.kind });
      }
    }
    return out;
  }, [alertHits, cardHits, completedOpen, completedRows, completedMatchKeys]);
  const others = useMemo<OtherMatch[]>(() => {
    const out: OtherMatch[] = [];
    if (showCards) {
      const h = new Set(matchCards(hidden.map(toSearchCard), query));
      for (const c of hidden) if (h.has(c.id)) out.push({ id: c.id, title: c.title, where: 'hidden' });
    }
    if (!completedOpen) {
      for (const r of completedRows) {
        if (completedMatchKeys?.has(completedKey(r))) {
          out.push({ id: r.id, title: r.kind === 'card' ? r.title : r.item.title, where: 'completed', completedKind: r.kind });
        }
      }
    }
    return out;
  }, [showCards, hidden, query, completedOpen, completedRows, completedMatchKeys]);

  // Open Completed + scroll/highlight a row (search "Other matches" and Done-card deep links).
  const [reveal, setReveal] = useState<{ kind: 'card' | 'alert'; id: string } | null>(null);
  const revealRow = (kind: 'card' | 'alert', id: string): void => {
    setCompletedOpen(true);
    setReveal({ kind, id });
  };
  useEffect(() => {
    if (!reveal) return;
    const el = completedOpen ? document.getElementById(`completed-${reveal.kind}-${reveal.id}`) : null;
    if (!el) {
      if (!completedRows.some((r) => r.kind === reveal.kind && r.id === reveal.id)) setReveal(null);
      return;
    }
    setReveal(null);
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('card-highlight');
    window.setTimeout(() => el.classList.remove('card-highlight'), HIGHLIGHT_MS);
  }, [reveal, completedOpen, completedRows]);

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
      if (filter === 'alerts') setFilter('all');
      revealRow('card', c.id);
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

  const noCards = columns.left.length + columns.center.length + columns.right.length + now.length === 0;

  return (
    <>
      <Header
        alertCount={alerts.length}
        hidden={hidden}
        filter={filter}
        onFilter={setFilter}
        connectionOk={state.consecutiveFailures === 0}
        minimal={down}
        onUnhide={(id) => void m.unhide(id)}
        search={{
          query,
          onQuery: setQuery,
          visible,
          total: visible.length + others.length,
          others,
          onUnhide: (id) => void m.unhide(id),
          onOpenCompleted: (o) => revealRow(o.completedKind ?? 'card', o.id),
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
            {filter !== 'cards' ? (
              <AlertStrip alerts={alerts} matchIds={alertMatchIds} nowPriorityThreshold={threshold} onTick={(id) => void m.tick(id)} />
            ) : null}
            {filter === 'alerts' && alerts.length === 0 ? (
              <p className="filter-empty" data-testid="empty-alerts">No alerts</p>
            ) : null}
            {filter === 'cards' && noCards ? (
              <p className="filter-empty" data-testid="empty-cards">No cards</p>
            ) : null}
            {filter !== 'alerts' ? (
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
            ) : null}
            <Completed
              rows={completedRows}
              open={completedOpen}
              onToggle={setCompletedOpen}
              matchKeys={completedMatchKeys}
              onReopen={(id) => void m.reopen(id)}
            />
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
