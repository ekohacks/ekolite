import { ClientSocketWrapper } from './clientSocket.ts';
import { ReactiveStore } from './reactiveStore.ts';
import { DataMsg, ServerMessage, SubscribeMsg, UnsubscribeMsg } from '../shared/protocol.ts';
import { assertNever } from '../shared/helperFunctions.ts';

export interface SubscriptionHandle {
  stop(): void;
  ready: Promise<void>;
}

interface SubscriptionState {
  readyResolver: () => void;
  readyRejector: (error: unknown) => void;
  // Learned from the server: ready.collection when present, otherwise inferred
  // from the initial data buffered before ready. Undefined until then.
  collection?: string;
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

const generateSubscriptionId = (): string => {
  return globalThis.crypto.randomUUID();
};

export class ConnectionManager {
  private readonly socket: ClientSocketWrapper;
  private readonly stores = new Map<string, ReactiveStore>();
  private readonly subscriptions = new Map<string, SubscriptionState>();
  private readonly teardownMessageListener: () => void;
  private readonly teardownCloseListener: () => void;
  private disposed = false;
  // Initial `added` documents that arrive before their subscription has learned
  // its collection. Held here until the matching `ready` binds the collection,
  // then flushed into the store. See handleServerMessage.
  private pendingData: DataMsg[] = [];

  constructor(socket: ClientSocketWrapper) {
    this.socket = socket;
    // The disposed flag is consulted in three places to enforce the lifecycle contract:
    // (1) in the message listener to ignore incoming messages after disposal,
    // (2) in store() to prevent resurrecting stores, and
    // (3) in subscribe() to prevent creating new subscriptions.
    this.teardownMessageListener = this.socket.onMessage((message) => {
      if (!this.disposed) {
        this.handleServerMessage(message);
      }
    });
    this.teardownCloseListener = this.socket.onClose(() => {
      this.dispose();
    });
  }

  subscribe(name: string, params?: Record<string, unknown>): SubscriptionHandle {
    this.assertNotDisposed();

    const id = generateSubscriptionId();
    let resolveReady!: () => void;
    let rejectReady!: (error: unknown) => void;

    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    this.subscriptions.set(id, {
      readyResolver: resolveReady,
      readyRejector: rejectReady,
    });

    const subscribeMessage: SubscribeMsg = {
      type: 'subscribe',
      id,
      name,
      ...(params ? { params } : {}),
    };

    this.socket.send(subscribeMessage).catch((error: unknown) => {
      this.subscriptions.delete(id);
      rejectReady(error);
    });

    return new SubscriptionHandleImpl(this, id, ready);
  }

  stopSubscription(id: string): void {
    const unsubscribeMessage: UnsubscribeMsg = { type: 'unsubscribe', id };

    const subscription = this.subscriptions.get(id);

    if (subscription) {
      subscription.readyRejector(new Error('subscription stopped before ready'));
    }

    this.subscriptions.delete(id);

    this.socket.send(unsubscribeMessage).catch((error: unknown) => {
      console.error('Failed to send unsubscribe message:', error);
    });
  }

  store(collection: string): ReactiveStore {
    this.assertNotDisposed();
    let store = this.stores.get(collection);
    if (!store) {
      store = new ReactiveStore();
      this.stores.set(collection, store);
    }

    return store;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.teardownMessageListener();
    this.teardownCloseListener();

    for (const id of Array.from(this.subscriptions.keys())) {
      this.stopSubscription(id);
    }

    this.subscriptions.clear();
    this.stores.clear();
    this.pendingData = [];
  }

  // Test seam: exposes internal state so tests can assert teardown happened.
  activeSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error('ConnectionManager is disposed');
    }
  }

  private isCollectionLive(collection: string): boolean {
    for (const sub of this.subscriptions.values()) {
      if (sub.collection === collection) {
        return true;
      }
    }
    return false;
  }

  // True while at least one subscription is still waiting to learn its
  // collection from a ready. Only then do we hold onto data we cannot place
  // yet; once every sub is bound, unplaceable data is a late message to drop,
  // not initial data to buffer.
  private hasUnboundSubscription(): boolean {
    for (const sub of this.subscriptions.values()) {
      if (sub.collection === undefined) {
        return true;
      }
    }
    return false;
  }

  // Route any buffered initial documents for a now-known collection into its
  // store, keeping the rest waiting for their own ready.
  private flushPending(collection: string): void {
    const remaining: DataMsg[] = [];
    for (const message of this.pendingData) {
      if (message.collection === collection) {
        this.store(collection).handleMessage(message);
      } else {
        remaining.push(message);
      }
    }
    this.pendingData = remaining;
  }

  private handleServerMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'added': {
        if (this.isCollectionLive(message.collection)) {
          this.store(message.collection).handleMessage(message);
        } else if (this.hasUnboundSubscription()) {
          // Initial data for a subscription that has not learned its collection
          // yet. Hold it until the matching ready binds the collection.
          this.pendingData.push(message);
        }
        break;
      }
      case 'changed':
      case 'removed': {
        // No buffering: changed/removed only ever apply to data already added,
        // so anything for a collection that is not live is a late message the
        // stop() gate drops.
        if (this.isCollectionLive(message.collection)) {
          this.store(message.collection).handleMessage(message);
        }
        break;
      }
      case 'ready': {
        const subscription = this.subscriptions.get(message.id);
        if (subscription) {
          // The server names the collection on ready, so bind the subscription
          // to it and flush any initial data buffered before it arrived.
          subscription.collection = message.collection;
          this.flushPending(message.collection);
          subscription.readyResolver();
        }
        break;
      }
      case 'result':
        break;
      case 'error': {
        const subscription = this.subscriptions.get(message.id);
        if (subscription) {
          subscription.readyRejector(message.error);
          this.subscriptions.delete(message.id);
        }
        break;
      }
      default:
        assertNever(message);
    }
  }
}
