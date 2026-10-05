import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { getMutations, useMutationView, type Mutations } from './api/mutations.ts';
import { getToastStore, type ToastStore } from './api/toasts.ts';
import type { ViewCard } from './api/types.ts';
import { CardFrame } from './frame/CardFrame.tsx';
import { Fullscreen } from './frame/Fullscreen.tsx';
import { buildCardHash, parseCardHash, replaceHash, useHash } from './lib/hash.ts';
import { getSeenVersion, subscribeSeen } from './lib/seen.ts';
import { matchCards, toSearchCard } from './lib/search.ts';
import { DoneTray } from './zones/DoneTray.tsx';
import { Grid } from './zones/Grid.tsx';
import { attentionCount, Header } from './zones/Header.tsx';
import { NowZone } from './zones/NowZone.tsx';
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
  const alerts = useMemo(() => pick(snap?.zones.alerts), [snap]);
  const now = useMemo(() => pick(snap?.zones.now), [snap]);
  const grid = useMemo(() => pick(snap?.zones.grid), [snap]);
  const tray = useMemo(() => pick(snap?.zones.tray), [snap]);
  const hidden = useMemo(() => pick(snap?.zones.hidden), [snap]);
  const threshold = snap?.config.nowPriorityThreshold ?? 5;
  const onItemAction = (cardId: string, itemId: string): Promise<void> => m.onItemAction(cardId, itemId);

  const searching = query.trim() !== '';
  const visible = useMemo(() => [...alerts, ...now, ...grid], [alerts, now, grid]);
  const visibleIds = useMemo(() => matchCards(visible.map(toSearchCard), query), [visible, query]);
  const matchIds = useMemo(() => (searching ? new Set(visibleIds) : null), [searching, visibleIds]);
  const others = useMemo(() => {
    const t = new Set(matchCards(tray.map(toSearchCard), query));
    const h = new Set(matchCards(hidden.map(toSearchCard), query));
    return [
      ...tray.filter((c) => t.has(c.id)).map((card) => ({ card, where: 'tray' as const })),
      ...hidden.filter((c) => h.has(c.id)).map((card) => ({ card, where: 'hidden' as const })),
    ];
  }, [tray, hidden, query]);

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
    if (snap.zones.tray.includes(c.id)) {
      toasts.push(`${c.title} is Done`);
      return;
    }
    if (snap.zones.hidden.includes(c.id)) {
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
  const count = attentionCount(alerts, [...now, ...grid]);
  useEffect(() => {
    document.title = down ? 'Server down' : count > 0 ? `(${count}) Crontick` : 'Crontick';
  }, [count, down]);
  const empty =
    snap !== null && ['alerts', 'now', 'grid', 'tray', 'hidden'].every((z) => (snap.zones[z as keyof typeof snap.zones] ?? []).length === 0);

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
          onReopen: (id) => void m.undone(id),
          onUnhide: (id) => void m.unhide(id),
        }}
      />
      <main>
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
            <NowZone
              alerts={alerts}
              panels={now}
              query={query}
              matchIds={matchIds}
              nowPriorityThreshold={threshold}
              checked={m.getChecked}
              pending={m.getPending}
              onItemAction={onItemAction}
              onTick={(id) => void m.tick(id)}
              onDone={(id) => void m.done(id)}
              onHide={(id) => void m.hide(id)}
              onFullscreen={openFullscreen}
            />
            <section aria-labelledby="grid-zone-h" className="grid-section">
              <h2 id="grid-zone-h" className="sr-only">
                Cards
              </h2>
            <Grid
              cards={grid}
              layout={snap.layout}
              putLayout={m.putLayout}
              putLayoutKeepalive={m.putLayoutKeepalive}
              renderCard={(c) => (
                <CardFrame
                  card={c}
                  mode="grid"
                  query={query}
                  dim={searching && !matchIds?.has(c.id)}
                  match={Boolean(matchIds?.has(c.id))}
                  checked={m.getChecked(c.id)}
                  pending={m.getPending(c.id)}
                  nowPriorityThreshold={threshold}
                  onItemAction={(itemId) => onItemAction(c.id, itemId)}
                  onDone={(id) => void m.done(id)}
                  onHide={(id) => void m.hide(id)}
                  onFullscreen={openFullscreen}
                />
              )}
            />
            </section>
            <DoneTray cards={tray} onReopen={(id) => void m.undone(id)} />
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
          onItemAction={(itemId) => onItemAction(fsCard.id, itemId)}
          onDone={(id) => void m.done(id)}
          onHide={(id) => void m.hide(id)}
          onClose={closeFullscreen}
        />
      ) : null}
      {down ? null : <ToastHost store={toasts} />}
    </>
  );
}
