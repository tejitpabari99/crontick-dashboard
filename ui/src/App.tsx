import { useMemo } from 'react';
import { getMutations, useMutationView } from './api/mutations.ts';
import type { ViewCard } from './api/types.ts';
import { CardFrame } from './frame/CardFrame.tsx';
import { DoneTray } from './zones/DoneTray.tsx';
import { Grid } from './zones/Grid.tsx';
import { NowZone } from './zones/NowZone.tsx';

export function App() {
  const m = getMutations();
  const { state } = useMutationView(m);
  const snap = state.snapshot;
  const pick = (ids: readonly string[] | undefined): ViewCard[] =>
    (ids ?? []).map((id) => snap?.cards[id]).filter((c): c is ViewCard => Boolean(c));
  const alerts = useMemo(() => pick(snap?.zones.alerts), [snap]);
  const now = useMemo(() => pick(snap?.zones.now), [snap]);
  const grid = useMemo(() => pick(snap?.zones.grid), [snap]);
  const tray = useMemo(() => pick(snap?.zones.tray), [snap]);
  const threshold = snap?.config.nowPriorityThreshold ?? 5;
  const noop = (): void => undefined;
  const onItemAction = (cardId: string, itemId: string): Promise<void> => m.onItemAction(cardId, itemId);

  return (
    <main>
      <h1>Crontick</h1>
      {snap ? (
        <>
          <NowZone
            alerts={alerts}
            panels={now}
            query=""
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
                query=""
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
  );
}
