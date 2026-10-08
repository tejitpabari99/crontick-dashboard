import { useEffect, useSyncExternalStore } from 'react';
import { getToastStore, type Toast, type ToastStore } from '../api/toasts.ts';
import { TOAST_MS } from '../constants/timing.ts';

function Item({ toast, store }: { toast: Toast; store: ToastStore }) {
  useEffect(() => {
    const t = setTimeout(() => store.dismiss(toast.id), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast.id, store]);
  return (
    <li className="toast">
      <span>{toast.message}</span>
      <button type="button" aria-label="Dismiss" onClick={() => store.dismiss(toast.id)}>
        ×
      </button>
    </li>
  );
}

export function ToastHost({ store = getToastStore() }: { store?: ToastStore }) {
  const toasts = useSyncExternalStore(store.subscribe, store.getSnapshot);
  if (toasts.length === 0) return null;
  return (
    <ul className="toast-host" role="status" aria-live="polite">
      {toasts.map((t) => (
        <Item key={t.id} toast={t} store={store} />
      ))}
    </ul>
  );
}
