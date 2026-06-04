import { ClientSocketWrapper } from './clientSocket.ts';
import { ReactiveStore } from './reactiveStore.ts';
import { ServerMessage, SubscribeMsg, UnsubscribeMsg } from '../shared/protocol.ts';
import { assertNever } from '../shared/helperFunctions.ts';

interface SubscriptionHandle {
  stop(): void;
  ready: Promise<void>;
}

interface SubscriptionState {
  readyResolver: () => void;
  readyRejector: (error: unknown) => void;
  collection: string;
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

    const collection = this.getCollectionFromPublicationName(name);
    this.subscriptions.set(id, {
      readyResolver: resolveReady,
      readyRejector: rejectReady,
      collection,
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

  private getCollectionFromPublicationName(name: string): string {
    return name.split('.')[0];
  }

  private handleServerMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'added':
      case 'changed':
      case 'removed': {
        if (this.isCollectionLive(message.collection)) {
          this.store(message.collection).handleMessage(message);
        }
        break;
      }
      case 'ready': {
        const subscription = this.subscriptions.get(message.id);
        if (subscription) {
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
