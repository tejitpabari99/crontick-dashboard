export interface Toast {
  id: number;
  message: string;
}

export interface ToastStore {
  subscribe(listener: () => void): () => void;
  /** Stable reference until the queue changes. */
  getSnapshot(): readonly Toast[];
  push(message: string): number;
  dismiss(id: number): void;
}

export function createToastStore(): ToastStore {
  let toasts: readonly Toast[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const l of [...listeners]) l();
  };
  return {
    subscribe(l) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    getSnapshot: () => toasts,
    push(message) {
      const id = nextId++;
      toasts = [...toasts, { id, message }];
      emit();
      return id;
    },
    dismiss(id) {
      const next = toasts.filter((t) => t.id !== id);
      if (next.length === toasts.length) return;
      toasts = next;
      emit();
    },
  };
}

let defaultToasts: ToastStore | null = null;
export function getToastStore(): ToastStore {
  return (defaultToasts ??= createToastStore());
}
