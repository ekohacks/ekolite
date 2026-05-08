import { ClientSocketWrapper } from './clientSocket.ts';
import { ReactiveStore } from './reactiveStore.ts';
import { ServerMessage, SubscribeMsg, UnsubscribeMsg } from '../shared/protocol.ts';

interface SubscriptionHandle {
  stop(): void;
  ready: Promise<void>;
}

interface SubscriptionState {
  id: string;
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
  private readonly liveSubs = new Set<string>();

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
      readyResolver: resolveReady,
      readyRejector: rejectReady,
    });
    this.liveSubs.add(id);

    const subscribeMessage: SubscribeMsg = {
      type: 'subscribe',
      id,
      name,
    };

    this.socket.send(subscribeMessage).catch((error: unknown) => {
      this.subscriptions.delete(id);
      this.liveSubs.delete(id);
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
        if (this.liveSubs.size === 0) {
          return;
        }

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
      case 'error': {
        const subscription = this.subscriptions.get(message.id);
        if (subscription) {
          subscription.readyRejector(message.error);
          this.subscriptions.delete(message.id);
          this.liveSubs.delete(message.id);
        }
        break;
      }
      default:
        break;
    }
  }

  private markSubscriptionStopped(id: string): void {
    this.liveSubs.delete(id);
  }
}
