import { ClientSocketWrapper } from './clientSocket.ts';
import { ReactiveStore } from './reactiveStore.ts';
import { ServerMessage, SubscribeMsg, UnsubscribeMsg } from '../shared/protocol.ts';

interface SubscriptionHandle {
  stop(): void;
  ready: Promise<void>;
}

interface SubscriptionState {
  id: string;
  live: boolean;
  collections: Set<string>;
  readyResolver: () => void;
  readyRejector: (error: unknown) => void;
}

class SubscriptionHandleImpl implements SubscriptionHandle {
  readonly ready: Promise<void>;

  constructor(
    private manager: ConnectionManager,
    private subscriptionId: string,
    readyPromise: Promise<void>,
  ) {
    this.ready = readyPromise;
  }

  stop(): void {
    this.manager.stopSubscription(this.subscriptionId);
  }
}

const generateSubscriptionId = (() => {
  let counter = 0;
  return (): string => {
    if (
      typeof globalThis.crypto !== 'undefined' &&
      typeof globalThis.crypto.randomUUID === 'function'
    ) {
      return globalThis.crypto.randomUUID();
    }

    counter += 1;
    return `sub-${String(counter)}`;
  };
})();

export class ConnectionManager {
  private readonly socket: ClientSocketWrapper;
  private readonly stores = new Map<string, ReactiveStore>();
  private readonly subscriptions = new Map<string, SubscriptionState>();
  private readonly collectionLiveSubscriptions = new Map<string, Set<string>>();

  constructor(socket: ClientSocketWrapper) {
    this.socket = socket;
    this.socket.onMessage((message) => {
      this.handleServerMessage(message);
    });
  }

  subscribe(name: string): SubscriptionHandle {
    const id = generateSubscriptionId();
    let resolveReady!: () => void;
    let rejectReady!: (error: unknown) => void;

    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    this.subscriptions.set(id, {
      id,
      live: true,
      collections: new Set<string>(),
      readyResolver: resolveReady,
      readyRejector: rejectReady,
    });

    const subscribeMessage: SubscribeMsg = {
      type: 'subscribe',
      id,
      name,
    };

    this.socket.send(subscribeMessage).catch((error: unknown) => {
      this.subscriptions.delete(id);
      rejectReady(error);
    });

    return new SubscriptionHandleImpl(this, id, ready);
  }

  stopSubscription(id: string): void {
    const unsubscribeMessage: UnsubscribeMsg = { type: 'unsubscribe', id };
    this.socket.send(unsubscribeMessage).catch((error: unknown) => {
      console.error('Failed to send unsubscribe message:', error);
    });
    this.markSubscriptionStopped(id);
  }

  store(collection: string): ReactiveStore {
    let store = this.stores.get(collection);
    if (!store) {
      store = new ReactiveStore();
      this.stores.set(collection, store);
    }

    return store;
  }

  private handleServerMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'added':
      case 'changed':
      case 'removed': {
        if (!this.shouldRouteDataForCollection(message.collection)) {
          return;
        }

        this.markCollectionAsLive(message.collection);
        this.store(message.collection).handleMessage(message);
        break;
      }
      case 'ready': {
        const subscription = this.subscriptions.get(message.id);
        if (subscription) {
          subscription.readyResolver();
        }
        break;
      }
      default:
        break;
    }
  }

  private shouldRouteDataForCollection(collection: string): boolean {
    const liveSubscribersForCollection = this.collectionLiveSubscriptions.get(collection);
    if (liveSubscribersForCollection && liveSubscribersForCollection.size > 0) {
      return true;
    }

    return this.hasAnyLiveSubscription();
  }

  private markCollectionAsLive(collection: string): void {
    if (this.collectionLiveSubscriptions.has(collection)) {
      return;
    }

    const liveSubscribers = new Set<string>();
    for (const [id, subscription] of this.subscriptions.entries()) {
      if (subscription.live) {
        liveSubscribers.add(id);
        subscription.collections.add(collection);
      }
    }

    if (liveSubscribers.size > 0) {
      this.collectionLiveSubscriptions.set(collection, liveSubscribers);
    }
  }

  private markSubscriptionStopped(id: string): void {
    const subscription = this.subscriptions.get(id);
    if (!subscription?.live) {
      return;
    }

    subscription.live = false;

    for (const collection of subscription.collections) {
      const activeSet = this.collectionLiveSubscriptions.get(collection);
      if (!activeSet) {
        continue;
      }
      activeSet.delete(id);
      if (activeSet.size === 0) {
        this.collectionLiveSubscriptions.delete(collection);
      }
    }

    subscription.collections.clear();
  }

  private hasAnyLiveSubscription(): boolean {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.live) {
        return true;
      }
    }
    return false;
  }
}
