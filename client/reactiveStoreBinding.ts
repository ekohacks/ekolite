import { ReactiveStore } from './reactiveStore.ts';

type StoredDocWithId = Record<string, unknown> & { _id: string };

export interface StoreBinding {
  subscribe: (onStoreChange: () => void) => () => void;
  getSnapshot: () => StoredDocWithId[];
}

// The framework-agnostic core of the React hook. useSyncExternalStore wants a
// subscribe/getSnapshot pair where getSnapshot returns a stable reference until
// something actually changes — but ReactiveStore.getAll() builds a fresh array every
// call, which would make React loop. bindStore caches the snapshot and recomputes it
// once per change, inside the change handler, before notifying the consumer.
export function bindStore(store: ReactiveStore): StoreBinding {
  let snapshot = store.getAll();

  return {
    subscribe: (onStoreChange: () => void): (() => void) =>
      store.onChange(() => {
        snapshot = store.getAll();
        onStoreChange();
      }),
    getSnapshot: (): StoredDocWithId[] => snapshot,
  };
}
