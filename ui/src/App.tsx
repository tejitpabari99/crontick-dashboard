import { useEffect, useMemo, useState } from 'react';
import { getMutations, useMutationView, type Mutations } from './api/mutations.ts';
import { getToastStore, type ToastStore } from './api/toasts.ts';
import type { ViewCard } from './api/types.ts';
import { CardFrame } from './frame/CardFrame.tsx';
import { matchCards, toSearchCard } from './lib/search.ts';
import { DoneTray } from './zones/DoneTray.tsx';
import { Grid } from './zones/Grid.tsx';
import { attentionCount, Header } from './zones/Header.tsx';
import { NowZone } from './zones/NowZone.tsx';
import { ToastHost } from './zones/ToastHost.tsx';

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
  const pick = (ids: readonly string[] | undefined): ViewCard[] =>
    (ids ?? []).map((id) => snap?.cards[id]).filter((c): c is ViewCard => Boolean(c));
  const alerts = useMemo(() => pick(snap?.zones.alerts), [snap]);
  const now = useMemo(() => pick(snap?.zones.now), [snap]);
  const grid = useMemo(() => pick(snap?.zones.grid), [snap]);
  const tray = useMemo(() => pick(snap?.zones.tray), [snap]);
  const hidden = useMemo(() => pick(snap?.zones.hidden), [snap]);
  const threshold = snap?.config.nowPriorityThreshold ?? 5;
  const noop = (): void => undefined;
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

  const count = attentionCount(alerts, [...now, ...grid]);
  useEffect(() => {
    document.title = count > 0 ? `(${count}) Crontick` : 'Crontick';
  }, [count]);

  return (
    <>
      <Header
        alertCount={alerts.length}
        hidden={hidden}
        connectionOk={state.consecutiveFailures === 0}
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
        {snap ? (
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
              onFullscreen={noop}
            />
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
                  onFullscreen={noop}
                />
              )}
            />
            <DoneTray cards={tray} onReopen={(id) => void m.undone(id)} />
          </>
        ) : null}
      </main>
      <ToastHost store={toasts} />
    </>
  );
}
