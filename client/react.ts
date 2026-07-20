import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ConnectionManager } from './connectionManager.ts';
import { bindStore } from './reactiveStoreBinding.ts';

type StoredDocWithId = Record<string, unknown> & { _id: string };

export interface UseSubscriptionResult {
  data: StoredDocWithId[];
  isLoading: boolean;
}

// The React binding — Meteor's useTracker, for EkoLite. Subscribes on mount, streams
// the collection's live documents through useSyncExternalStore, and reports isLoading
// until the subscription is ready; stops the subscription on unmount. A thin wrapper
// over bindStore (the tested subscribe/getSnapshot core) and ConnectionManager.
//
// The collection name is passed explicitly rather than derived from the subscription
// name: the server chooses the collection and it is not exposed on the handle.
export function useSubscription(
  manager: ConnectionManager,
  name: string,
  collection: string,
  params?: Record<string, unknown>,
): UseSubscriptionResult {
  const [isLoading, setIsLoading] = useState(true);
  // params is folded into a stable string so the effect only re-runs when it truly
  // changes, not on every render's fresh object identity.
  const paramsKey = JSON.stringify(params ?? null);

  useEffect(() => {
    const handle = manager.subscribe(name, params ?? undefined);
    let active = true;
    const done = () => {
      if (active) {
        setIsLoading(false);
      }
    };
    handle.ready.then(done, done);
    return () => {
      active = false;
      handle.stop();
    };
  }, [manager, name, paramsKey]);

  // manager.store(collection) returns the same cached store instance each render, so
  // the binding stays stable and useSyncExternalStore does not resubscribe every time.
  const store = manager.store(collection);
  const binding = useMemo(() => bindStore(store), [store]);
  const data = useSyncExternalStore(binding.subscribe, binding.getSnapshot);

  return { data, isLoading };
}
